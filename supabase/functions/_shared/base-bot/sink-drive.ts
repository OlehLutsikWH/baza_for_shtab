// Сховище фото через сервісний акаунт «Штабу» — ЛИШЕ для папки на спільному диску (Google Workspace).
// В особистому «Мій диск» Google не дає сервісному акаунту створювати файли (немає власного місця на диску) —
// для такої папки «Фото» є sink-script.ts (Apps Script від імені власника папки).
import type { Drive, DFolder } from '../google-drive.ts';
import { KIND_FOLDER, type PhotoSink } from './core.ts';

const FOLDER_TTL_MS = 5 * 60_000;
/** Назва нової папки авто: «АВТО-030 Ford Ranger» (як ті, що створює координатор). */
export const vehicleFolderName = (id: string, name: string) => `${id} ${name}`.replace(/[\\/\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
export const folderUrl = (f: DFolder) => f.webViewLink ?? `https://drive.google.com/drive/folders/${f.id}`;

export function createDrivePhotoSink(drive: Drive, photosFolderId: string, now: () => number = () => Date.now()): PhotoSink {
  // папку авто запам'ятовуємо ненадовго: альбом з 10 фото — один пошук, а перейменування/переміщення людиною підхопиться
  const cache = new Map<string, { f: DFolder; at: number }>();
  async function carFolder(id: string, name: string): Promise<DFolder> {
    const c = cache.get(id);
    if (c && now() - c.at < FOLDER_TTL_MS) return c.f;
    const f = (await drive.findVehicleFolder(photosFolderId, id)) ?? (await drive.createFolder(photosFolderId, vehicleFolderName(id, name)));
    cache.set(id, { f, at: now() });
    return f;
  }
  return {
    async save(p) {
      const car = await carFolder(p.vehicleId, p.vehicleName);
      const sub = p.kind === 'other' ? null : await drive.ensureFolder(car.id, KIND_FOLDER[p.kind]);
      const target = sub ?? car;
      // повтор після обриву: файл з такою назвою вже є — не дублюємо
      const f = (await drive.findFile(target.id, p.fileName)) ?? (await drive.upload(target.id, p.fileName, p.mime, p.bytes));
      return { fileId: f.id, folderName: sub ? `${car.name} / ${sub.name}` : car.name, folderUrl: folderUrl(car) };
    },
  };
}
