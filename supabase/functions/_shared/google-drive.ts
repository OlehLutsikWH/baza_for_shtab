// Google Drive через сервісний акаунт «Штабу»: токен (JWT RS256), пошук папки авто, підпапки, завантаження.
// Без залежностей — працює в Deno (Edge Functions) і в Node (тести).

export interface ServiceAccount { client_email: string; private_key: string; token_uri?: string }
export const SCOPE_READ = 'https://www.googleapis.com/auth/drive.readonly';
export const SCOPE_WRITE = 'https://www.googleapis.com/auth/drive';
export const FOLDER_MIME = 'application/vnd.google-apps.folder';
const API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const MAX_LIST = 500;

// ---------- base64url і криптографія (Web Crypto: є і в Deno, і в Node 20+) ----------
const enc = new TextEncoder();
export function b64url(data: ArrayBuffer | Uint8Array | string): string {
  const bytes = typeof data === 'string' ? enc.encode(data) : data instanceof Uint8Array ? data : new Uint8Array(data);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function pemToDer(pem: string): ArrayBuffer {
  const body = pem.replace(/-----(BEGIN|END) [^-]+-----/g, '').replace(/\s+/g, '');
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

/** Токен доступу сервісного акаунта з кешем (оновлюється за хвилину до закінчення). */
export function createGoogleAuth(sa: ServiceAccount, scope: string, fetchFn: typeof fetch, now: () => number) {
  let cached: { value: string; exp: number } | null = null;
  return async function token(): Promise<string> {
    if (cached && cached.exp - 60_000 > now()) return cached.value;
    const aud = sa.token_uri ?? 'https://oauth2.googleapis.com/token';
    const iat = Math.floor(now() / 1000);
    const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify({ iss: sa.client_email, scope, aud, iat, exp: iat + 3600 }))}`;
    const key = await crypto.subtle.importKey('pkcs8', pemToDer(sa.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
    const jwt = `${unsigned}.${b64url(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(unsigned)))}`;
    const res = await fetchFn(aud, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }).toString(),
    });
    if (!res.ok) throw new Error(`Google токен: ${res.status}`);
    const t = (await res.json()) as { access_token: string; expires_in: number };
    cached = { value: t.access_token, exp: now() + t.expires_in * 1000 };
    return cached.value;
  };
}

export interface DFile {
  id: string; name: string; mimeType: string; createdTime?: string; webViewLink?: string; parents?: string[];
  imageMediaMetadata?: { time?: string }; thumbnailLink?: string;
}
export interface DFolder { id: string; name: string; webViewLink?: string }

/** Рядок у запиті Drive: 'текст' з екрануванням. */
export const dq = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
/** «АВТО-02» не має знайти «АВТО-021»: після номера — кінець назви або не цифра. */
export const isVehicleFolderName = (name: string, vehicleId: string) =>
  name.trim().startsWith(vehicleId) && !/^\d/.test(name.trim().slice(vehicleId.length));

/** Зрозуміла помилка Drive. Головна пастка: сервісний акаунт не має власного місця на диску і не може
 *  створювати файли в особистому «Мій диск» (лише на спільному диску Google Workspace). */
async function driveError(r: Response, what: string): Promise<Error> {
  const j = (await r.json().catch(() => null)) as { error?: { errors?: { reason?: string }[]; message?: string } } | null;
  const reason = j?.error?.errors?.[0]?.reason ?? '';
  if (reason === 'storageQuotaExceeded' || /storage quota/i.test(j?.error?.message ?? '')) {
    return new Error('Google Drive: сервісний акаунт не може класти файли в особистий «Мій диск» — потрібен спільний диск або скрипт від імені власника папки (див. INTEGRATION.md)');
  }
  return new Error(`Google Drive (${what}): ${r.status}${reason ? ` ${reason}` : ''}`);
}

export function createDrive(token: () => Promise<string>, fetchFn: typeof fetch) {
  const auth = async () => ({ Authorization: `Bearer ${await token()}` });

  async function get(path: string, params: Record<string, string> = {}): Promise<Response> {
    const q = new URLSearchParams({ supportsAllDrives: 'true', ...params });
    return fetchFn(`${API}${path}?${q}`, { headers: await auth() });
  }
  async function getJson<T>(path: string, params: Record<string, string>): Promise<T> {
    const r = await get(path, params);
    if (!r.ok) throw new Error(`Google Drive: ${r.status}`);
    return (await r.json()) as T;
  }
  async function list(q: string, fields: string, orderBy?: string): Promise<{ files: DFile[]; truncated: boolean }> {
    const files: DFile[] = [];
    let pageToken: string | undefined;
    do {
      const r = await getJson<{ files: DFile[]; nextPageToken?: string }>('', {
        q, fields: `nextPageToken, files(${fields})`, pageSize: '200', includeItemsFromAllDrives: 'true',
        ...(orderBy ? { orderBy } : {}), ...(pageToken ? { pageToken } : {}),
      });
      files.push(...r.files);
      pageToken = r.nextPageToken;
    } while (pageToken && files.length < MAX_LIST);
    return { files: files.slice(0, MAX_LIST), truncated: !!pageToken || files.length > MAX_LIST };
  }
  async function findVehicleFolder(photosFolderId: string, vehicleId: string): Promise<DFolder | null> {
    const r = await list(`${dq(photosFolderId)} in parents and mimeType = '${FOLDER_MIME}' and trashed = false and name contains ${dq(vehicleId)}`, 'id, name, webViewLink');
    return r.files.filter(f => isVehicleFolderName(f.name, vehicleId)).sort((a, b) => a.name.localeCompare(b.name))[0] ?? null;
  }
  async function createFolder(parentId: string, name: string): Promise<DFolder> {
    const q = new URLSearchParams({ supportsAllDrives: 'true', fields: 'id, name, webViewLink' });
    const r = await fetchFn(`${API}?${q}`, {
      method: 'POST', headers: { ...(await auth()), 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
    });
    if (!r.ok) throw await driveError(r, 'папка');
    return (await r.json()) as DFolder;
  }
  /** Файл з точною назвою в папці (щоб повторне надсилання не створювало копію). */
  async function findFile(parentId: string, name: string): Promise<DFile | null> {
    const r = await list(`${dq(parentId)} in parents and name = ${dq(name)} and trashed = false and mimeType != '${FOLDER_MIME}'`, 'id, name, mimeType, webViewLink');
    return r.files[0] ?? null;
  }
  /** Підпапка з точною назвою: знайти або створити. */
  async function ensureFolder(parentId: string, name: string): Promise<DFolder> {
    const r = await list(`${dq(parentId)} in parents and mimeType = '${FOLDER_MIME}' and trashed = false and name = ${dq(name)}`, 'id, name, webViewLink');
    return r.files[0] ?? createFolder(parentId, name);
  }
  /** Завантаження файлу одним запитом (multipart; для фото з Telegram — до 20 МБ — цього досить). */
  async function upload(parentId: string, name: string, mime: string, bytes: Uint8Array): Promise<DFile> {
    const boundary = `baza${crypto.getRandomValues(new Uint32Array(2)).join('')}`;
    const head = enc.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [parentId] })}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`);
    const tail = enc.encode(`\r\n--${boundary}--`);
    const body = new Uint8Array(head.length + bytes.length + tail.length);
    body.set(head, 0); body.set(bytes, head.length); body.set(tail, head.length + bytes.length);
    const q = new URLSearchParams({ uploadType: 'multipart', supportsAllDrives: 'true', fields: 'id, name, webViewLink' });
    const r = await fetchFn(`${UPLOAD}?${q}`, {
      method: 'POST', headers: { ...(await auth()), 'Content-Type': `multipart/related; boundary=${boundary}` }, body,
    });
    if (!r.ok) throw await driveError(r, 'завантаження');
    return (await r.json()) as DFile;
  }
  return { get, getJson, list, findVehicleFolder, createFolder, findFile, ensureFolder, upload, auth };
}
export type Drive = ReturnType<typeof createDrive>;
