// Ядро функції base-drive: фото авто з Google Drive через сервісний акаунт «Штабу».
// Без залежностей від Deno — працює і в Edge Function (index.ts), і в тестах (Node).
//
//  POST {action:"list", vehicle:"АВТО-021"}  + Authorization: Bearer <JWT користувача>
//       → { folder: {id,name,url} | null, photos: [{id,name,mimeType,takenAt,group,thumb,full}], truncated }
//  GET  ?action=image&id=…&w=…&exp=…&sig=…   (підписане посилання з list, діє 1 год, без JWT —
//       щоб працювали <img> і генератор PDF)
//
// Доступ до Drive — лише читання (scope drive.readonly). Папка авто — підпапка «Фото», назва якої
// починається з номера авто: «АВТО-021 Toyota Hilux (білий)». Фото — прямо в ній або в її підпапках
// (назва підпапки повертається як group, напр. «До ремонту»).

export interface ServiceAccount { client_email: string; private_key: string; token_uri?: string }
export type AuthResult = 'ok' | 'unauthorized' | 'forbidden';

export interface DriveConfig {
  serviceAccount: ServiceAccount;
  /** id папки «Фото» на Drive */
  photosFolderId: string;
  /** секрет для підпису посилань на зображення */
  urlSecret: string;
  /** повна адреса цієї функції, напр. https://xyz.supabase.co/functions/v1/base-drive */
  publicBaseUrl: string;
  fetch: typeof fetch;
  now: () => number;
  /** перевірка, що запит від члена команди (у «Штабі» — base_can_read() з JWT користувача) */
  authorize: (authorization: string | null) => Promise<AuthResult>;
  allowedOrigin?: string;
  /** скільки діє підписане посилання, с */
  urlTtlSeconds?: number;
}

export interface DrivePhoto {
  id: string; name: string; mimeType: string; takenAt: string | null; group: string | null; thumb: string; full: string;
}

const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const FOLDER = 'application/vnd.google-apps.folder';
export const THUMB_W = 480, FULL_W = 1600;
const MAX_PHOTOS = 500;
const VEHICLE_ID = /^[A-ZА-ЯІЇЄҐ]{2,10}-\d{1,5}$/u;
const FILE_ID = /^[A-Za-z0-9_-]{10,200}$/;

// ---------- base64url і криптографія (Web Crypto: є і в Deno, і в Node 20+) ----------
const enc = new TextEncoder();
function b64url(data: ArrayBuffer | Uint8Array | string): string {
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
async function hmac(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** Підписане посилання на зображення: перевіряється без JWT, але лише до exp. */
export async function signImageUrl(cfg: Pick<DriveConfig, 'urlSecret' | 'publicBaseUrl' | 'now' | 'urlTtlSeconds'>, id: string, w: number): Promise<string> {
  const exp = Math.floor(cfg.now() / 1000) + (cfg.urlTtlSeconds ?? 3600);
  const sig = await hmac(cfg.urlSecret, `${id}.${w}.${exp}`);
  const q = new URLSearchParams({ action: 'image', id, w: String(w), exp: String(exp), sig });
  return `${cfg.publicBaseUrl}?${q}`;
}

// ---------- обробник ----------
export function createHandler(cfg: DriveConfig) {
  let token: { value: string; exp: number } | null = null;
  const cors = {
    'Access-Control-Allow-Origin': cfg.allowedOrigin ?? '*',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });
  const fail = (status: number, error: string) => json(status, { error });

  async function accessToken(): Promise<string> {
    if (token && token.exp - 60_000 > cfg.now()) return token.value;
    const sa = cfg.serviceAccount;
    const aud = sa.token_uri ?? 'https://oauth2.googleapis.com/token';
    const iat = Math.floor(cfg.now() / 1000);
    const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud, iat, exp: iat + 3600 }))}`;
    const key = await crypto.subtle.importKey('pkcs8', pemToDer(sa.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
    const jwt = `${unsigned}.${b64url(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(unsigned)))}`;
    const res = await cfg.fetch(aud, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }).toString(),
    });
    if (!res.ok) throw new Error(`Google токен: ${res.status}`);
    const t = (await res.json()) as { access_token: string; expires_in: number };
    token = { value: t.access_token, exp: cfg.now() + t.expires_in * 1000 };
    return token.value;
  }
  async function drive(path: string, params: Record<string, string> = {}): Promise<Response> {
    const q = new URLSearchParams({ supportsAllDrives: 'true', ...params });
    return cfg.fetch(`${DRIVE}${path}?${q}`, { headers: { Authorization: `Bearer ${await accessToken()}` } });
  }
  async function driveJson<T>(path: string, params: Record<string, string>): Promise<T> {
    const r = await drive(path, params);
    if (!r.ok) throw new Error(`Google Drive: ${r.status}`);
    return (await r.json()) as T;
  }
  type DFile = { id: string; name: string; mimeType: string; createdTime?: string; webViewLink?: string; parents?: string[];
    imageMediaMetadata?: { time?: string } };
  async function listAll(q: string, fields: string, orderBy?: string): Promise<{ files: DFile[]; truncated: boolean }> {
    const files: DFile[] = [];
    let pageToken: string | undefined;
    do {
      const r = await driveJson<{ files: DFile[]; nextPageToken?: string }>('', {
        q, fields: `nextPageToken, files(${fields})`, pageSize: '200', includeItemsFromAllDrives: 'true',
        ...(orderBy ? { orderBy } : {}), ...(pageToken ? { pageToken } : {}),
      });
      files.push(...r.files);
      pageToken = r.nextPageToken;
    } while (pageToken && files.length < MAX_PHOTOS);
    return { files: files.slice(0, MAX_PHOTOS), truncated: !!pageToken || files.length > MAX_PHOTOS };
  }
  const quote = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

  async function list(vehicle: string) {
    const found = await listAll(
      `${quote(cfg.photosFolderId)} in parents and mimeType = '${FOLDER}' and trashed = false and name contains ${quote(vehicle)}`,
      'id, name, webViewLink');
    // «АВТО-02» не має знайти «АВТО-021»: після номера — кінець назви або не цифра
    const exact = new RegExp(`^${vehicle}(?!\\d)`, 'u'); // vehicle уже перевірено VEHICLE_ID: лише літери, «-», цифри
    const folder = found.files.filter(f => exact.test(f.name.trim())).sort((a, b) => a.name.localeCompare(b.name))[0];
    if (!folder) return { folder: null, photos: [] as DrivePhoto[], truncated: false };
    const subs = await listAll(`${quote(folder.id)} in parents and mimeType = '${FOLDER}' and trashed = false`, 'id, name');
    const groupOf = new Map(subs.files.map(f => [f.id, f.name] as const));
    const parents = [folder.id, ...subs.files.map(f => f.id)];
    const imgs = await listAll(
      `(${parents.map(p => `${quote(p)} in parents`).join(' or ')}) and mimeType contains 'image/' and trashed = false`,
      'id, name, mimeType, createdTime, parents, imageMediaMetadata(time)', 'createdTime');
    const photos: DrivePhoto[] = [];
    for (const f of imgs.files) {
      if (!FILE_ID.test(f.id)) continue;
      const parent = (f.parents ?? []).find(p => groupOf.has(p));
      photos.push({
        id: f.id, name: f.name, mimeType: f.mimeType, takenAt: f.imageMediaMetadata?.time ?? f.createdTime ?? null,
        group: parent ? groupOf.get(parent)! : null,
        thumb: await signImageUrl(cfg, f.id, THUMB_W), full: await signImageUrl(cfg, f.id, FULL_W),
      });
    }
    return { folder: { id: folder.id, name: folder.name, url: folder.webViewLink ?? `https://drive.google.com/drive/folders/${folder.id}` }, photos, truncated: imgs.truncated };
  }

  async function image(url: URL): Promise<Response> {
    const id = url.searchParams.get('id') ?? '', w = Number(url.searchParams.get('w')), exp = Number(url.searchParams.get('exp'));
    const sig = url.searchParams.get('sig') ?? '';
    if (!FILE_ID.test(id) || ![THUMB_W, FULL_W].includes(w) || !Number.isFinite(exp)) return fail(400, 'Неправильне посилання');
    if (exp * 1000 < cfg.now()) return fail(403, 'Посилання застаріло, оновіть сторінку');
    if (!safeEqual(sig, await hmac(cfg.urlSecret, `${id}.${w}.${exp}`))) return fail(403, 'Неправильний підпис посилання');
    const meta = await drive(`/${encodeURIComponent(id)}`, { fields: 'mimeType, thumbnailLink' });
    if (meta.status === 404) return fail(404, 'Фото не знайдено');
    if (!meta.ok) return fail(502, `Google Drive: ${meta.status}`);
    const m = (await meta.json()) as { mimeType: string; thumbnailLink?: string };
    let res: Response | null = null;
    // Мініатюра потрібного розміру (JPEG) легша за оригінал з телефона і працює для HEIC
    if (m.thumbnailLink) {
      const t = await cfg.fetch(m.thumbnailLink.replace(/=s\d+(-[a-z]+)?$/, `=s${w}`), { headers: { Authorization: `Bearer ${await accessToken()}` } });
      if (t.ok) res = t;
    }
    if (!res && (m.mimeType === 'image/jpeg' || m.mimeType === 'image/png')) {
      const o = await drive(`/${encodeURIComponent(id)}`, { alt: 'media' });
      if (o.ok) res = o;
    }
    if (!res) return fail(415, 'Цей формат фото не вдалося показати');
    return new Response(res.body, {
      status: 200,
      headers: { ...cors, 'Content-Type': res.headers.get('content-type') ?? 'image/jpeg', 'Cache-Control': 'private, max-age=3600' },
    });
  }

  return async function handle(req: Request): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      const url = new URL(req.url);
      if (req.method === 'GET' && url.searchParams.get('action') === 'image') return await image(url);
      if (req.method !== 'POST') return fail(405, 'Метод не підтримується');
      const auth = await cfg.authorize(req.headers.get('authorization'));
      if (auth === 'unauthorized') return fail(401, 'Потрібно увійти в «Штаб»');
      if (auth === 'forbidden') return fail(403, 'Фото доступні лише членам команди');
      const body = (await req.json().catch(() => ({}))) as { action?: string; vehicle?: string };
      if (body.action !== 'list') return fail(400, 'Невідома дія');
      const vehicle = (body.vehicle ?? '').trim();
      if (!VEHICLE_ID.test(vehicle)) return fail(400, 'Неправильний номер авто');
      return json(200, await list(vehicle));
    } catch (e) {
      return fail(502, e instanceof Error ? e.message : String(e));
    }
  };
}
