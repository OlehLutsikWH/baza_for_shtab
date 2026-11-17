// Сховище фото через Apps Script (google-apps-script/baza-photos/Code.gs), розгорнутий як вебзастосунок
// від імені власника папки «Фото». Так файли належать власнику папки, як і ті, що кладуться вручну,
// і працює з особистим «Мій диск» (сервісному акаунту Google туди класти файли не дає).
import type { PhotoSink, SavedPhoto } from './core.ts';

/** base64 для байтів без Buffer (Deno і Node); шматками, щоб не впертися в обмеження аргументів. */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function createScriptPhotoSink(o: { url: string; secret: string; fetch?: typeof fetch }): PhotoSink {
  const f = o.fetch ?? fetch;
  return {
    async save(p): Promise<SavedPhoto> {
      // Apps Script відповідає перенаправленням на script.googleusercontent.com — fetch іде за ним сам
      const r = await f(o.url, {
        method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          secret: o.secret, action: 'save', vehicleId: p.vehicleId, vehicleName: p.vehicleName, kind: p.kind,
          fileName: p.fileName, mime: p.mime, data: bytesToBase64(p.bytes),
        }),
      });
      const text = await r.text();
      let j: { ok?: boolean; error?: string; fileId?: string; folderName?: string; folderUrl?: string };
      try { j = JSON.parse(text); } catch {
        throw new Error(`Скрипт фото відповів не так, як очікувалось (${r.status}). Перевірте розгортання: «Виконувати як: я», доступ «Усі».`);
      }
      if (!j.ok || !j.fileId || !j.folderName || !j.folderUrl) throw new Error(`Скрипт фото: ${j.error ?? 'неочікувана відповідь'}`);
      return { fileId: j.fileId, folderName: j.folderName, folderUrl: j.folderUrl };
    },
  };
}
