// Спільний модуль Google Drive: токен із правом запису, папки, пошук файлу, завантаження multipart, зрозумілі помилки.
import { describe, it, expect, beforeAll } from 'vitest';
import { createDrive, createGoogleAuth, dq, isVehicleFolderName, SCOPE_READ, SCOPE_WRITE } from '../supabase/functions/_shared/google-drive';
import { createFakeGoogle, makeServiceAccount, FOLDER, type FakeFile } from './fake-google';

let sa: { client_email: string; private_key: string };
let publicKey: CryptoKey;
beforeAll(async () => ({ sa, publicKey } = await makeServiceAccount()));
const NOW = Date.UTC(2026, 10, 17, 10);
const PHOTOS = 'photosRoot123456';
const tree = (): FakeFile[] => [
  { id: 'car021folder01', name: 'АВТО-021 Toyota Hilux (білий)', mimeType: FOLDER, parents: [PHOTOS], webViewLink: 'https://drive.google.com/drive/folders/car021folder01' },
  { id: 'car0210folder1', name: 'АВТО-0210 Інша', mimeType: FOLDER, parents: [PHOTOS] },
  { id: 'before021fold1', name: 'До ремонту', mimeType: FOLDER, parents: ['car021folder01'] },
  { id: 'oldphoto000001', name: '2026-11-01_АВТО-021_7.jpg', mimeType: 'image/jpeg', parents: ['before021fold1'] },
];
function setup(extra: Partial<Parameters<typeof createFakeGoogle>[0]> = {}) {
  const g = createFakeGoogle({ publicKey, scope: SCOPE_WRITE, files: tree(), ...extra });
  const drive = createDrive(createGoogleAuth(sa, SCOPE_WRITE, g.fetch, () => NOW), g.fetch);
  return { g, drive };
}

describe('google-drive: доступ', () => {
  it('токен із правом запису (scope drive), підпис JWT перевірено ключем, кеш на годину', async () => {
    const { g, drive } = setup();
    await drive.findVehicleFolder(PHOTOS, 'АВТО-021');
    await drive.findFile('before021fold1', 'x.jpg');
    expect(g.tokenCalls).toBe(1);
    expect(SCOPE_WRITE).toBe('https://www.googleapis.com/auth/drive');
  });
  it('токен лише для читання не підходить там, де очікується запис', async () => {
    const g = createFakeGoogle({ publicKey, scope: SCOPE_WRITE, files: tree() });
    const drive = createDrive(createGoogleAuth(sa, SCOPE_READ, g.fetch, () => NOW), g.fetch);
    await expect(drive.findVehicleFolder(PHOTOS, 'АВТО-021')).rejects.toThrow('Google токен: 400');
  });
});

describe('google-drive: папки й файли', () => {
  it('папка авто — точний номер (АВТО-021, не АВТО-0210); АВТО-02 — нічого', async () => {
    const { drive } = setup();
    expect((await drive.findVehicleFolder(PHOTOS, 'АВТО-021'))?.id).toBe('car021folder01');
    expect(await drive.findVehicleFolder(PHOTOS, 'АВТО-02')).toBeNull();
    expect(isVehicleFolderName('АВТО-021 Toyota', 'АВТО-021')).toBe(true);
    expect(isVehicleFolderName('АВТО-0210', 'АВТО-021')).toBe(false);
    expect(isVehicleFolderName('  АВТО-021', 'АВТО-021')).toBe(true);
  });
  it('ensureFolder: наявну підпапку знаходить, відсутню створює (одна, з правильним батьком)', async () => {
    const { g, drive } = setup();
    expect((await drive.ensureFolder('car021folder01', 'До ремонту')).id).toBe('before021fold1');
    expect(g.calls.filter(c => c.method === 'POST' && c.url.startsWith('https://www.googleapis.com/'))).toHaveLength(0);
    const after = await drive.ensureFolder('car021folder01', 'Після ремонту');
    expect(g.files.find(f => f.id === after.id)).toMatchObject({ name: 'Після ремонту', mimeType: FOLDER, parents: ['car021folder01'] });
    expect((await drive.ensureFolder('car021folder01', 'Після ремонту')).id).toBe(after.id);
    expect(g.files.filter(f => f.name === 'Після ремонту')).toHaveLength(1);
  });
  it('findFile: точна назва в папці, без папок і кошика', async () => {
    const { g, drive } = setup();
    expect((await drive.findFile('before021fold1', '2026-11-01_АВТО-021_7.jpg'))?.id).toBe('oldphoto000001');
    expect(await drive.findFile('before021fold1', '2026-11-01_АВТО-021_8.jpg')).toBeNull();
    g.files[3].trashed = true;
    expect(await drive.findFile('before021fold1', '2026-11-01_АВТО-021_7.jpg')).toBeNull();
  });
  it('лапки й зворотні скісні в назвах екрануються в запиті', async () => {
    expect(dq("Ком'як \\ x")).toBe("'Ком\\'як \\\\ x'");
    const { g, drive } = setup();
    g.files.push({ id: 'quoted0000001', name: "Ком'як", mimeType: FOLDER, parents: ['car021folder01'] });
    expect((await drive.ensureFolder('car021folder01', "Ком'як")).id).toBe('quoted0000001');
  });
});

describe('google-drive: завантаження', () => {
  it('multipart: метадані з назвою й батьком, байти без змін (включно з 0x00 і 0xFF), закриваюча межа', async () => {
    const { g, drive } = setup();
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x0d, 0x0a, 0x2d, 0x2d, 0x80, 0xfe, 0x00, 0xff, 0xd9]);
    const f = await drive.upload('before021fold1', '2026-11-17_АВТО-021_12.jpg', 'image/jpeg', bytes);
    const up = g.uploads[0];
    expect(up.metadata).toEqual({ name: '2026-11-17_АВТО-021_12.jpg', parents: ['before021fold1'] });
    expect(up.mime).toBe('image/jpeg');
    expect(Array.from(up.bytes)).toEqual(Array.from(bytes));
    expect(up.closed).toBe(true);
    expect(up.query.get('uploadType')).toBe('multipart');
    expect(g.files.find(x => x.id === f.id)?.parents).toEqual(['before021fold1']);
  });
  it('особистий «Мій диск»: Google відмовляє сервісному акаунту — зрозуміле пояснення, що робити', async () => {
    const { drive } = setup({ quotaError: true });
    await expect(drive.upload('before021fold1', 'a.jpg', 'image/jpeg', new Uint8Array([1]))).rejects.toThrow(/не може класти файли в особистий «Мій диск».*спільний диск або скрипт/);
  });
  it('інша помилка — код і причина Google', async () => {
    const { drive } = setup({ failUploadAt: [1] });
    await expect(drive.upload('before021fold1', 'a.jpg', 'image/jpeg', new Uint8Array([1]))).rejects.toThrow('Google Drive (завантаження): 500 backendError');
  });
});
