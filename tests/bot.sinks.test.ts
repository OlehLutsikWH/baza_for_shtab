// Куди бот кладе фото: (1) Apps Script від імені власника папки «Фото» — для особистого «Мій диск»;
// (2) сервісний акаунт — для спільного диска. Плюс сам скрипт Code.gs з імітацією служб Apps Script.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDrive, createGoogleAuth, SCOPE_WRITE } from '../supabase/functions/_shared/google-drive';
import { createDrivePhotoSink, vehicleFolderName } from '../supabase/functions/_shared/base-bot/sink-drive';
import { createScriptPhotoSink, bytesToBase64 } from '../supabase/functions/_shared/base-bot/sink-script';
import { createFakeGoogle, makeServiceAccount, FOLDER, type FakeFile } from './fake-google';

const PHOTOS = 'photosRoot123456';
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0xff, 0xd9]);
const photo = (kind: 'before' | 'after' | 'other', fileName = '2026-11-18_АВТО-021_1.jpg', vehicleId = 'АВТО-021', vehicleName = 'Toyota Hilux (білий)') =>
  ({ vehicleId, vehicleName, kind, fileName, mime: 'image/jpeg', bytes: JPEG });

describe('сховище фото: сервісний акаунт (спільний диск)', () => {
  let sa: { client_email: string; private_key: string }, publicKey: CryptoKey;
  beforeAll(async () => ({ sa, publicKey } = await makeServiceAccount()));
  const files = (): FakeFile[] => [
    { id: 'car021folder01', name: 'АВТО-021 Toyota Hilux (білий)', mimeType: FOLDER, parents: [PHOTOS], webViewLink: 'https://drive.google.com/drive/folders/car021folder01' },
    { id: 'car0210folder1', name: 'АВТО-0210 Інша', mimeType: FOLDER, parents: [PHOTOS] },
    { id: 'before021fold1', name: 'До ремонту', mimeType: FOLDER, parents: ['car021folder01'] },
  ];
  function setup(extra: Partial<Parameters<typeof createFakeGoogle>[0]> = {}) {
    const g = createFakeGoogle({ publicKey, scope: SCOPE_WRITE, files: files(), ...extra });
    let t = Date.UTC(2026, 10, 18, 7);
    const clock = { now: () => t, add: (ms: number) => { t += ms; } };
    const sink = createDrivePhotoSink(createDrive(createGoogleAuth(sa, SCOPE_WRITE, g.fetch, clock.now), g.fetch), PHOTOS, clock.now);
    const folderSearches = () => g.calls.filter(c => c.url.includes('name+contains') || decodeURIComponent(c.url).includes('name contains')).length;
    return { g, sink, clock, folderSearches };
  }
  it('наявна папка авто й підпапка «До ремонту»: файл саме туди, байти без змін', async () => {
    const { g, sink } = setup();
    const r = await sink.save(photo('before'));
    expect(r).toEqual({ fileId: expect.stringMatching(/^file/), folderName: 'АВТО-021 Toyota Hilux (білий) / До ремонту', folderUrl: 'https://drive.google.com/drive/folders/car021folder01' });
    expect(g.uploads[0].metadata).toEqual({ name: '2026-11-18_АВТО-021_1.jpg', parents: ['before021fold1'] });
    expect(Array.from(g.uploads[0].bytes)).toEqual(Array.from(JPEG));
  });
  it('«Після ремонту» створюється один раз; папка авто шукається один раз на альбом (кеш), а через 5 хв — знову', async () => {
    const { g, sink, clock, folderSearches } = setup();
    await sink.save(photo('after', 'a1.jpg'));
    await sink.save(photo('after', 'a2.jpg'));
    expect(g.files.filter(f => f.name === 'Після ремонту')).toHaveLength(1);
    expect(g.files.filter(f => f.parents.includes(g.files.find(x => x.name === 'Після ремонту')!.id)).map(f => f.name)).toEqual(['a1.jpg', 'a2.jpg']);
    expect(folderSearches()).toBe(1);
    clock.add(6 * 60_000);
    await sink.save(photo('after', 'a3.jpg'));
    expect(folderSearches()).toBe(2);
  });
  it('нової машини ще немає на Drive — створює «АВТО-030 Ford Ranger» (не плутаючи з АВТО-0210); «без підпапки» — у корінь папки авто', async () => {
    const { g, sink } = setup();
    const r = await sink.save(photo('other', 'x.jpg', 'АВТО-030', 'Ford Ranger'));
    const car = g.files.find(f => f.name === 'АВТО-030 Ford Ranger')!;
    expect(car).toMatchObject({ mimeType: FOLDER, parents: [PHOTOS] });
    expect(g.uploads[0].metadata.parents).toEqual([car.id]);
    expect(r.folderName).toBe('АВТО-030 Ford Ranger');
    expect(vehicleFolderName('АВТО-031', ' Пікап /  «Б» \n')).toBe('АВТО-031 Пікап «Б»');
  });
  it('повтор після обриву: файл з такою назвою вже є — нового не створює', async () => {
    const { g, sink } = setup();
    const first = await sink.save(photo('before'));
    const again = await sink.save(photo('before'));
    expect(again.fileId).toBe(first.fileId);
    expect(g.uploads).toHaveLength(1);
  });
  it('особистий «Мій диск» — зрозуміла помилка (саме тому для Олегової папки — скрипт)', async () => {
    const { sink } = setup({ quotaError: true });
    await expect(sink.save(photo('before'))).rejects.toThrow('сервісний акаунт не може класти файли в особистий «Мій диск»');
  });
});

describe('сховище фото: Apps Script', () => {
  it('надсилає секрет, дані й байти (base64), повертає папку', async () => {
    let req: any = null;
    const sink = createScriptPhotoSink({
      url: 'https://script.google.com/macros/s/XYZ/exec', secret: 's'.repeat(32),
      fetch: (async (url: string, init: any) => { req = { url, init, body: JSON.parse(init.body) }; return Response.json({ ok: true, fileId: 'F1', folderName: 'АВТО-021 Toyota Hilux (білий) / До ремонту', folderUrl: 'https://drive/x' }); }) as any,
    });
    const r = await sink.save(photo('before'));
    expect(r).toEqual({ fileId: 'F1', folderName: 'АВТО-021 Toyota Hilux (білий) / До ремонту', folderUrl: 'https://drive/x' });
    expect(req.url).toBe('https://script.google.com/macros/s/XYZ/exec');
    expect(req.init).toMatchObject({ method: 'POST', redirect: 'follow' });
    expect(req.body).toMatchObject({ secret: 's'.repeat(32), action: 'save', vehicleId: 'АВТО-021', vehicleName: 'Toyota Hilux (білий)', kind: 'before', fileName: '2026-11-18_АВТО-021_1.jpg', mime: 'image/jpeg' });
    expect(Array.from(Buffer.from(req.body.data, 'base64'))).toEqual(Array.from(JPEG));
  });
  it('base64 без Buffer: усі 256 значень байтів і великий файл', () => {
    const all = new Uint8Array(256).map((_, i) => i);
    expect(bytesToBase64(all)).toBe(Buffer.from(all).toString('base64'));
    const big = new Uint8Array(200_001).map((_, i) => (i * 31) & 255);
    expect(bytesToBase64(big)).toBe(Buffer.from(big).toString('base64'));
  });
  it('сторінка замість JSON (неправильне розгортання) і відмова скрипту — зрозумілі помилки', async () => {
    const html = createScriptPhotoSink({ url: 'u', secret: 's', fetch: (async () => new Response('<html>Sign in</html>', { status: 200 })) as any });
    await expect(html.save(photo('before'))).rejects.toThrow('Перевірте розгортання: «Виконувати як: я», доступ «Усі».');
    const no = createScriptPhotoSink({ url: 'u', secret: 's', fetch: (async () => Response.json({ ok: false, error: 'Неправильний секрет' })) as any });
    await expect(no.save(photo('before'))).rejects.toThrow('Скрипт фото: Неправильний секрет');
  });
});

// ---------- Code.gs з імітацією DriveApp, Utilities, ContentService, LockService ----------
class It<T> { private i = 0; constructor(private a: T[]) {} hasNext() { return this.i < this.a.length; } next() { return this.a[this.i++]; } }
let seq = 0;
class FFile {
  constructor(public id: string, public name: string, public mime: string, public bytes: number[], public trashed = false) {}
  getId() { return this.id; } isTrashed() { return this.trashed; }
}
class FFolder {
  folders: FFolder[] = []; files: FFile[] = [];
  constructor(public id: string, public name: string, public trashed = false) {}
  getId() { return this.id; } getName() { return this.name; } isTrashed() { return this.trashed; }
  getUrl() { return `https://drive.google.com/drive/folders/${this.id}`; }
  getFolders() { return new It(this.folders); }
  getFoldersByName(n: string) { return new It(this.folders.filter(f => f.name === n)); }
  createFolder(n: string) { const f = new FFolder(`fold${++seq}`, n); this.folders.push(f); return f; }
  getFilesByName(n: string) { return new It(this.files.filter(f => f.name === n)); }
  createFile(b: { bytes: number[]; mime: string; name: string }) { const f = new FFile(`file${++seq}`, b.name, b.mime, b.bytes); this.files.push(f); return f; }
}
const SECRET = 'test-secret-0123456789abcdef';
function loadScript(props: Record<string, string> = { SECRET, PHOTOS_FOLDER_ID: PHOTOS }) {
  const src = readFileSync(fileURLToPath(new URL('../google-apps-script/baza-photos/Code.gs', import.meta.url)), 'utf8');
  const photos = new FFolder(PHOTOS, 'Фото');
  const car21 = photos.createFolder('АВТО-021 Toyota Hilux (білий)');
  photos.createFolder('АВТО-0210 Інша');
  const trashed = new FFolder('trash1', 'АВТО-025 стара', true); photos.folders.unshift(trashed);
  const lock = { waits: 0, releases: 0, waitLock() { this.waits++; }, releaseLock() { this.releases++; } };
  const services = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k: string) => props[k] ?? null }) },
    DriveApp: { getFolderById: (id: string) => { if (id !== PHOTOS) throw new Error('No item with the given ID could be found'); return photos; } },
    Utilities: {
      base64Decode: (s: string) => Array.from(Buffer.from(s, 'base64')).map(b => (b > 127 ? b - 256 : b)), // як у Apps Script: знакові байти
      newBlob: (bytes: number[], mime: string, name: string) => ({ bytes, mime, name }),
    },
    ContentService: { MimeType: { JSON: 'application/json' }, createTextOutput: (s: string) => ({ body: s, mime: '', setMimeType(m: string) { this.mime = m; return this; } }) },
    LockService: { getScriptLock: () => lock },
  };
  const fn = new Function(...Object.keys(services), `${src}\nreturn { doGet, doPost };`);
  const gs = fn(...Object.values(services)) as { doGet: () => any; doPost: (e: any) => any };
  const post = (body: Record<string, unknown>) => {
    const out = gs.doPost({ postData: { contents: JSON.stringify(body) } });
    expect(out.mime).toBe('application/json');
    return JSON.parse(out.body);
  };
  return { gs, post, photos, car21, lock };
}
const req = (patch: Record<string, unknown> = {}) => ({ secret: SECRET, action: 'save', vehicleId: 'АВТО-021', vehicleName: 'Toyota Hilux (білий)', kind: 'before', fileName: '2026-11-18_АВТО-021_1.jpg', mime: 'image/jpeg', data: Buffer.from(JPEG).toString('base64'), ...patch });
const unsigned = (b: number[]) => b.map(x => (x < 0 ? x + 256 : x));

describe('Apps Script Code.gs', () => {
  it('перевірка розгортання (GET) і відмова без правильного секрету — нічого не створює', () => {
    const { gs, post, photos } = loadScript();
    expect(JSON.parse(gs.doGet().body)).toEqual({ ok: true, service: 'baza-photos' });
    expect(post(req({ secret: 'wrong' }))).toEqual({ ok: false, error: 'Неправильний секрет' });
    expect(post(req({ secret: undefined }))).toEqual({ ok: false, error: 'Неправильний секрет' });
    expect(photos.folders).toHaveLength(3);
    const short = loadScript({ SECRET: 'short', PHOTOS_FOLDER_ID: PHOTOS });
    expect(short.post(req({ secret: 'short' }))).toEqual({ ok: false, error: 'Неправильний секрет' }); // занадто короткий секрет не приймається
  });
  it('кладе в «АВТО-021 …/До ремонту» (не в АВТО-0210), підпапку створює один раз, байти ті самі, повтор не дублює', () => {
    const { post, car21, lock } = loadScript();
    const r = post(req());
    expect(r).toEqual({ ok: true, fileId: expect.stringMatching(/^file/), folderName: 'АВТО-021 Toyota Hilux (білий) / До ремонту', folderUrl: car21.getUrl() });
    const before = car21.folders.find(f => f.name === 'До ремонту')!;
    expect(unsigned(before.files[0].bytes)).toEqual(Array.from(JPEG));
    expect(before.files[0]).toMatchObject({ name: '2026-11-18_АВТО-021_1.jpg', mime: 'image/jpeg' });
    expect(post(req()).fileId).toBe(r.fileId);
    post(req({ fileName: '2026-11-18_АВТО-021_2.jpg' }));
    expect(car21.folders.filter(f => f.name === 'До ремонту')).toHaveLength(1);
    expect(before.files).toHaveLength(2);
    expect([lock.waits, lock.releases]).toEqual([3, 3]);
  });
  it('нова машина — папка «АВТО-030 Ford Ranger»; «без підпапки» — у корінь; папка в кошику не рахується', () => {
    const { post, photos } = loadScript();
    const r = post(req({ vehicleId: 'АВТО-030', vehicleName: 'Ford Ranger', kind: 'other' }));
    const car = photos.folders.find(f => f.name === 'АВТО-030 Ford Ranger')!;
    expect(car.files).toHaveLength(1);
    expect(r.folderName).toBe('АВТО-030 Ford Ranger');
    post(req({ vehicleId: 'АВТО-025', vehicleName: 'Mitsubishi L200', kind: 'after' }));
    expect(photos.folders.find(f => f.name === 'АВТО-025 Mitsubishi L200')!.folders[0].name).toBe('Після ремонту');
  });
  it('перевірка даних: номер авто, підпапка, лише фото, порожній файл; помилка Drive — текстом, замок звільнено', () => {
    const { post, lock } = loadScript();
    expect(post(req({ vehicleId: "АВТО-021' or 1=1" }))).toEqual({ ok: false, error: 'Неправильний номер авто' });
    expect(post(req({ kind: 'trash' }))).toEqual({ ok: false, error: 'Неправильна підпапка' });
    expect(post(req({ mime: 'application/pdf' }))).toEqual({ ok: false, error: 'Приймаю лише фото' });
    expect(post(req({ mime: 'image/svg+xml' }))).toEqual({ ok: false, error: 'Приймаю лише фото' });
    expect(post(req({ data: '' }))).toEqual({ ok: false, error: 'Порожній або завеликий файл' });
    expect(post(req({ action: 'delete' }))).toEqual({ ok: false, error: 'Невідома дія' });
    const wrongFolder = loadScript({ SECRET, PHOTOS_FOLDER_ID: 'другий' });
    expect(wrongFolder.post(req())).toEqual({ ok: false, error: 'No item with the given ID could be found' });
    expect([wrongFolder.lock.waits, wrongFolder.lock.releases]).toEqual([1, 1]);
    expect(lock.waits).toBe(0);
  });
});
