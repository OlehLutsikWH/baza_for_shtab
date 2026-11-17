// Імітація Google для тестів: видача токена сервісному акаунту (з перевіркою підпису JWT справжнім ключем RSA)
// і Drive v3 у пам'яті — пошук за запитом q, створення папок, завантаження multipart.
export interface FakeFile {
  id: string; name: string; mimeType: string; parents: string[]; trashed?: boolean; webViewLink?: string; bytes?: Uint8Array;
}
export const FOLDER = 'application/vnd.google-apps.folder';
const unb64url = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

export async function makeServiceAccount(email = 'shtab-svit@shtab-tykho.iam.gserviceaccount.com') {
  const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const der = Buffer.from(await crypto.subtle.exportKey('pkcs8', kp.privateKey)).toString('base64');
  const private_key = `-----BEGIN PRIVATE KEY-----\n${der.match(/.{1,64}/g)!.join('\n')}\n-----END PRIVATE KEY-----\n`;
  return { sa: { client_email: email, private_key }, publicKey: kp.publicKey };
}

// --- мінімальний розбір запиту q, який формує google-drive.ts ---
function unq(s: string) { return s.replace(/\\(.)/g, '$1'); }
function splitTop(q: string, sep: ' and ' | ' or '): string[] {
  const out: string[] = []; let depth = 0, inStr = false, cur = '';
  for (let i = 0; i < q.length; i++) {
    const ch = q[i];
    if (inStr) { cur += ch; if (ch === '\\') { cur += q[++i]; continue; } if (ch === "'") inStr = false; continue; }
    if (ch === "'") { inStr = true; cur += ch; continue; }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (depth === 0 && q.startsWith(sep, i)) { out.push(cur); cur = ''; i += sep.length - 1; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map(s => s.trim());
}
function matches(f: FakeFile, q: string): boolean {
  return splitTop(q, ' and ').every(clause => {
    if (clause.startsWith('(') && clause.endsWith(')')) return splitTop(clause.slice(1, -1), ' or ').some(c => matches(f, c));
    let m: RegExpExecArray | null;
    if ((m = /^'((?:[^'\\]|\\.)*)' in parents$/.exec(clause))) return f.parents.includes(unq(m[1]));
    if ((m = /^mimeType (=|!=|contains) '((?:[^'\\]|\\.)*)'$/.exec(clause))) {
      const v = unq(m[2]);
      return m[1] === '=' ? f.mimeType === v : m[1] === '!=' ? f.mimeType !== v : f.mimeType.includes(v);
    }
    if ((m = /^name (=|contains) '((?:[^'\\]|\\.)*)'$/.exec(clause))) return m[1] === '=' ? f.name === unq(m[2]) : f.name.includes(unq(m[2]));
    if (clause === 'trashed = false') return !f.trashed;
    throw new Error(`fake drive: незнайома умова ${clause}`);
  });
}

function parseMultipart(body: Uint8Array, contentType: string) {
  const boundary = /boundary=([^;]+)/.exec(contentType)![1];
  const bin = Buffer.from(body).toString('latin1');
  const parts: { headers: string; bytes: Uint8Array }[] = [];
  let pos = bin.indexOf(`--${boundary}\r\n`);
  while (pos !== -1) {
    const headStart = pos + boundary.length + 4;
    const headEnd = bin.indexOf('\r\n\r\n', headStart);
    const next = bin.indexOf(`\r\n--${boundary}`, headEnd);
    parts.push({ headers: bin.slice(headStart, headEnd), bytes: body.slice(headEnd + 4, next) });
    if (bin.startsWith(`\r\n--${boundary}--`, next)) break;
    pos = next + 2;
  }
  return { boundary, parts, closed: bin.endsWith(`\r\n--${boundary}--`) };
}

export function createFakeGoogle(o: { publicKey: CryptoKey; email?: string; scope: string; files?: FakeFile[]; quotaError?: boolean; failUploadAt?: number[] }) {
  const files: FakeFile[] = o.files ?? [];
  const calls: { method: string; url: string; auth: string | null }[] = [];
  const uploads: { metadata: any; mime: string; bytes: Uint8Array; boundary: string; closed: boolean; query: URLSearchParams }[] = [];
  let tokenCalls = 0, seq = 0, uploadCount = 0;
  const fetchFn: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? 'GET';
    const headers = new Headers(init?.headers);
    calls.push({ method, url, auth: headers.get('authorization') });
    if (url === 'https://oauth2.googleapis.com/token') {
      tokenCalls++;
      const assertion = new URLSearchParams(String(init!.body)).get('assertion')!;
      const [h, c, sig] = assertion.split('.');
      const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', o.publicKey, unb64url(sig), new TextEncoder().encode(`${h}.${c}`));
      const claims = JSON.parse(unb64url(c).toString());
      if (!ok || claims.iss !== (o.email ?? 'shtab-svit@shtab-tykho.iam.gserviceaccount.com') || claims.scope !== o.scope) return new Response('bad assertion', { status: 400 });
      return Response.json({ access_token: 'tok-w', expires_in: 3600 });
    }
    if (headers.get('authorization') !== 'Bearer tok-w') return new Response('no auth', { status: 401 });
    const u = new URL(url);
    if (u.searchParams.get('supportsAllDrives') !== 'true') return new Response('supportsAllDrives?', { status: 400 });
    if (u.pathname === '/drive/v3/files' && method === 'GET') {
      const q = u.searchParams.get('q')!;
      return Response.json({ files: files.filter(f => matches(f, q)).map(({ bytes, ...f }) => f) });
    }
    if (u.pathname === '/drive/v3/files' && method === 'POST') {
      const meta = JSON.parse(String(init!.body));
      const f: FakeFile = { id: `new${String(++seq).padStart(10, '0')}`, name: meta.name, mimeType: meta.mimeType, parents: meta.parents };
      f.webViewLink = `https://drive.google.com/drive/folders/${f.id}`;
      files.push(f);
      return Response.json({ id: f.id, name: f.name, webViewLink: f.webViewLink });
    }
    if (u.pathname === '/upload/drive/v3/files' && method === 'POST') {
      uploadCount++;
      if (o.quotaError) return Response.json({ error: { code: 403, message: 'Service Accounts do not have storage quota.', errors: [{ reason: 'storageQuotaExceeded' }] } }, { status: 403 });
      if (o.failUploadAt?.includes(uploadCount)) return Response.json({ error: { code: 500, errors: [{ reason: 'backendError' }] } }, { status: 500 });
      const mp = parseMultipart(init!.body as Uint8Array, headers.get('content-type')!);
      const metadata = JSON.parse(new TextDecoder().decode(mp.parts[0].bytes));
      const mime = /Content-Type: ([^\r\n]+)/.exec(mp.parts[1].headers)![1];
      uploads.push({ metadata, mime, bytes: mp.parts[1].bytes, boundary: mp.boundary, closed: mp.closed, query: u.searchParams });
      const f: FakeFile = { id: `file${String(++seq).padStart(10, '0')}`, name: metadata.name, mimeType: mime, parents: metadata.parents, bytes: mp.parts[1].bytes };
      files.push(f);
      return Response.json({ id: f.id, name: f.name });
    }
    return new Response('?', { status: 500 });
  };
  return { fetch: fetchFn, files, calls, uploads, get tokenCalls() { return tokenCalls; } };
}
