// Функція base-drive з імітацією Google (токен, Drive API, мініатюри). Перевіряє підпис JWT сервісного
// акаунта справжнім ключем RSA, точний пошук папки за номером авто, групи з підпапок, підписані посилання.
import { describe, it, expect, beforeAll } from 'vitest';
import { createHandler, signImageUrl, THUMB_W, FULL_W, type DriveConfig } from '../supabase/functions/base-drive/core';

const PHOTOS = 'photosRoot123456';
const BASE = 'https://xyz.supabase.co/functions/v1/base-drive';
let pem = '';
let publicKey: CryptoKey;
const calls: { url: string; auth: string | null }[] = [];
let tokenCalls = 0;
let now = Date.UTC(2026, 10, 17, 10, 0, 0);

const b64 = (buf: ArrayBuffer) => Buffer.from(buf).toString('base64');
const unb64url = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

beforeAll(async () => {
  const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  publicKey = kp.publicKey;
  const der = b64(await crypto.subtle.exportKey('pkcs8', kp.privateKey));
  pem = `-----BEGIN PRIVATE KEY-----\n${der.match(/.{1,64}/g)!.join('\n')}\n-----END PRIVATE KEY-----\n`;
});

const folders = [
  { id: 'folder021abcdef', name: 'АВТО-021 Toyota Hilux (білий)', webViewLink: 'https://drive.google.com/drive/folders/folder021abcdef' },
  { id: 'folder0210xyzab', name: 'АВТО-0210 Інша машина' },
];
const images = [
  { id: 'photoAAAAAAAA1', name: '1.jpg', mimeType: 'image/jpeg', parents: ['folder021abcdef'], createdTime: '2026-10-01T08:00:00Z' },
  { id: 'photoBBBBBBBB2', name: '2.heic', mimeType: 'image/heic', parents: ['subBeforeXYZ12'], createdTime: '2026-10-02T08:00:00Z', imageMediaMetadata: { time: '2026:10:01 10:00:00' } },
  { id: 'photoCCCCCCCC3', name: '3.jpg', mimeType: 'image/jpeg', parents: ['folder021abcdef'], createdTime: '2026-10-03T08:00:00Z' },
];
const meta: Record<string, { mimeType: string; thumbnailLink?: string }> = {
  photoAAAAAAAA1: { mimeType: 'image/jpeg', thumbnailLink: 'https://lh3.googleusercontent.com/t1=s220' },
  photoBBBBBBBB2: { mimeType: 'image/heic' },
  photoCCCCCCCC3: { mimeType: 'image/jpeg' },
};

const fakeFetch: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const auth = new Headers(init?.headers).get('authorization');
  calls.push({ url, auth });
  if (url === 'https://oauth2.googleapis.com/token') {
    tokenCalls++;
    const assertion = new URLSearchParams(String(init!.body)).get('assertion')!;
    const [h, c, sig] = assertion.split('.');
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, unb64url(sig), new TextEncoder().encode(`${h}.${c}`));
    const claims = JSON.parse(unb64url(c).toString());
    if (!ok || claims.iss !== 'shtab-svit@shtab-tykho.iam.gserviceaccount.com' || claims.scope !== 'https://www.googleapis.com/auth/drive.readonly'
      || claims.aud !== 'https://oauth2.googleapis.com/token' || claims.exp - claims.iat !== 3600) {
      return new Response('bad assertion', { status: 400 });
    }
    return Response.json({ access_token: 'tok-1', expires_in: 3600 });
  }
  if (auth !== 'Bearer tok-1') return new Response('no auth', { status: 401 });
  const u = new URL(url);
  if (u.hostname === 'lh3.googleusercontent.com') {
    return new Response(`THUMB-${u.pathname.split('=s')[1]}`, { headers: { 'content-type': 'image/jpeg' } });
  }
  if (u.pathname === '/drive/v3/files') {
    const q = u.searchParams.get('q')!;
    expect(u.searchParams.get('supportsAllDrives')).toBe('true');
    if (q.startsWith(`'${PHOTOS}' in parents`)) {
      const name = /name contains '([^']+)'/.exec(q)![1];
      return Response.json({ files: folders.filter(f => f.name.includes(name)) });
    }
    if (q.includes("mimeType contains 'image/'")) {
      // дві сторінки — перевірка пагінації
      if (!u.searchParams.get('pageToken')) return Response.json({ files: images.slice(0, 2), nextPageToken: 'p2' });
      return Response.json({ files: images.slice(2) });
    }
    if (q.startsWith("'folder021abcdef' in parents and mimeType = 'application/vnd.google-apps.folder'")) {
      return Response.json({ files: [{ id: 'subBeforeXYZ12', name: 'До ремонту' }] });
    }
    return Response.json({ files: [] });
  }
  const m = /^\/drive\/v3\/files\/([^/]+)$/.exec(u.pathname);
  if (m) {
    const id = decodeURIComponent(m[1]);
    if (!meta[id]) return new Response('not found', { status: 404 });
    if (u.searchParams.get('alt') === 'media') return new Response(`ORIGINAL-${id}`, { headers: { 'content-type': meta[id].mimeType } });
    return Response.json(meta[id]);
  }
  return new Response('?', { status: 500 });
};

function handler(patch: Partial<DriveConfig> = {}) {
  return createHandler({
    serviceAccount: { client_email: 'shtab-svit@shtab-tykho.iam.gserviceaccount.com', private_key: pem },
    photosFolderId: PHOTOS, urlSecret: 'test-secret-0123456789', publicBaseUrl: BASE, fetch: fakeFetch, now: () => now,
    authorize: async a => (a === 'Bearer member' ? 'ok' : a === 'Bearer stranger' ? 'forbidden' : 'unauthorized'),
    ...patch,
  });
}
const listReq = (vehicle: string, auth: string | null = 'Bearer member') =>
  new Request(BASE, { method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) }, body: JSON.stringify({ action: 'list', vehicle }) });

describe('base-drive: список фото', () => {
  it('без входу — 401, не член команди — 403, член — 200', async () => {
    const h = handler();
    expect((await h(listReq('АВТО-021', null))).status).toBe(401);
    expect((await h(listReq('АВТО-021', 'Bearer stranger'))).status).toBe(403);
    expect((await h(listReq('АВТО-021'))).status).toBe(200);
  });
  it('знаходить саме папку АВТО-021 (не АВТО-0210), бере фото з неї і з підпапок, усі сторінки', async () => {
    const r = await (await handler()(listReq('АВТО-021'))).json();
    expect(r.folder).toEqual({ id: 'folder021abcdef', name: 'АВТО-021 Toyota Hilux (білий)', url: 'https://drive.google.com/drive/folders/folder021abcdef' });
    expect(r.photos.map((p: any) => [p.id, p.group])).toEqual([['photoAAAAAAAA1', null], ['photoBBBBBBBB2', 'До ремонту'], ['photoCCCCCCCC3', null]]);
    expect(r.photos[1].takenAt).toBe('2026:10:01 10:00:00');
    expect(r.photos[0].thumb.startsWith(`${BASE}?action=image&id=photoAAAAAAAA1&w=${THUMB_W}&exp=`)).toBe(true);
    expect(r.photos[0].full).toContain(`&w=${FULL_W}&`);
    expect(r.truncated).toBe(false);
  });
  it('«АВТО-02» не збігається ні з АВТО-021, ні з АВТО-0210', async () => {
    const r = await (await handler()(listReq('АВТО-02'))).json();
    expect(r).toEqual({ folder: null, photos: [], truncated: false });
  });
  it('неправильний номер авто — 400 і жодного звернення до Google', async () => {
    calls.length = 0;
    const r = await handler()(listReq("АВТО-021' or name contains '"));
    expect(r.status).toBe(400);
    expect(calls).toEqual([]);
  });
  it('токен Google береться один раз і кешується; підпис JWT перевірено ключем', async () => {
    tokenCalls = 0;
    const h = handler();
    await h(listReq('АВТО-021')); await h(listReq('АВТО-021'));
    expect(tokenCalls).toBe(1);
    expect(calls.filter(c => c.url.startsWith('https://www.googleapis.com/')).every(c => c.auth === 'Bearer tok-1')).toBe(true);
  });
});

describe('base-drive: зображення за підписаним посиланням', () => {
  const cfg = { urlSecret: 'test-secret-0123456789', publicBaseUrl: BASE, now: () => now };
  it('мініатюра потрібного розміру, CORS, без JWT', async () => {
    const res = await handler()(new Request(await signImageUrl(cfg, 'photoAAAAAAAA1', FULL_W)));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(await res.text()).toBe(`THUMB-${FULL_W}`);
  });
  it('немає мініатюри: JPEG віддається оригіналом, HEIC — 415', async () => {
    expect(await (await handler()(new Request(await signImageUrl(cfg, 'photoCCCCCCCC3', THUMB_W)))).text()).toBe('ORIGINAL-photoCCCCCCCC3');
    expect((await handler()(new Request(await signImageUrl(cfg, 'photoBBBBBBBB2', THUMB_W)))).status).toBe(415);
  });
  it('підроблений підпис, інший розмір, прострочене посилання — відмова', async () => {
    const url = new URL(await signImageUrl(cfg, 'photoAAAAAAAA1', THUMB_W));
    const forged = new URL(url); forged.searchParams.set('id', 'photoCCCCCCCC3');
    expect((await handler()(new Request(forged))).status).toBe(403);
    const resized = new URL(url); resized.searchParams.set('w', '4000');
    expect((await handler()(new Request(resized))).status).toBe(400);
    const later = handler({ now: () => now + 2 * 3600_000 });
    expect((await later(new Request(url))).status).toBe(403);
  });
  it('видалене фото — 404', async () => {
    expect((await handler()(new Request(await signImageUrl(cfg, 'photoDELETED99', THUMB_W)))).status).toBe(404);
  });
  it('OPTIONS — 204 з CORS; інші методи — 405', async () => {
    const o = await handler()(new Request(BASE, { method: 'OPTIONS' }));
    expect(o.status).toBe(204);
    expect(o.headers.get('access-control-allow-headers')).toContain('authorization');
    expect((await handler()(new Request(BASE, { method: 'PUT' }))).status).toBe(405);
  });
});
