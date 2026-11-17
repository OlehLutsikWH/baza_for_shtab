/**
 * «База»: фото з Telegram-бота → папка авто на Google Drive.
 * Працює від імені власника папки «Фото», тому файли належать йому — так само, як ті, що кладуться вручну.
 * (Сервісному акаунту «Штабу» Google не дає створювати файли в особистому «Мій диск».)
 *
 * Налаштування — один раз, близько 5 хвилин, з акаунта власника папки «Фото»:
 *  1. script.google.com → «Новий проєкт» → назва «База — фото з бота» → замінити вміст Code.gs цим файлом → зберегти.
 *  2. ⚙ «Налаштування проєкту» → «Властивості скрипту» → «Додати властивість»:
 *       PHOTOS_FOLDER_ID = 11BtJAqleoMbj2mj6q9H9E13D_5oSUmHO          (папка «Фото»)
 *       SECRET           = довгий випадковий рядок, не коротший за 16 символів
 *                          (той самий рядок — у секрет BASE_PHOTO_SCRIPT_SECRET функції бота)
 *  3. «Розгорнути» → «Нове розгортання» → тип «Вебзастосунок»; «Виконувати як: я»; «Хто має доступ: усі».
 *     Google попросить дозвіл на Drive: це ваш власний скрипт («Додатково» → «Перейти до проєкту»).
 *  4. Скопіювати URL вебзастосунку → секрет BASE_PHOTO_SCRIPT_URL функції бота.
 *  Перевірка: відкрити URL у браузері — має показати {"ok":true,"service":"baza-photos"}.
 *  Після зміни коду: «Розгорнути» → «Керувати розгортаннями» → редагувати → «Нова версія» (URL не зміниться).
 *
 * Що скрипт робить: лише ДОДАЄ фото в підпапки «Фото» («АВТО-021 …/До ремонту», «…/Після ремонту» або в папку авто).
 * Нічого не видаляє, не читає й не віддає назовні, крім назви папки й посилання на неї. Без правильного SECRET — відмова.
 */
var KIND_FOLDER = { before: 'До ремонту', after: 'Після ремонту' };
var VEHICLE_ID = /^АВТО-\d{3}$/;
var MAX_BYTES = 20 * 1024 * 1024;

function doGet() {
  return json({ ok: true, service: 'baza-photos' });
}

function doPost(e) {
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var props = PropertiesService.getScriptProperties();
    var secret = props.getProperty('SECRET') || '';
    if (secret.length < 16 || !sameString(String(req.secret || ''), secret)) return json({ ok: false, error: 'Неправильний секрет' });
    if (req.action !== 'save') return json({ ok: false, error: 'Невідома дія' });
    return json(save(req, props.getProperty('PHOTOS_FOLDER_ID')));
  } catch (err) {
    return json({ ok: false, error: String((err && err.message) || err).slice(0, 300) });
  }
}

function save(req, photosFolderId) {
  var vehicleId = String(req.vehicleId || '');
  if (!VEHICLE_ID.test(vehicleId)) return { ok: false, error: 'Неправильний номер авто' };
  var kind = String(req.kind || '');
  if (kind !== 'before' && kind !== 'after' && kind !== 'other') return { ok: false, error: 'Неправильна підпапка' };
  var mime = String(req.mime || '');
  if (mime.indexOf('image/') !== 0 || mime === 'image/svg+xml') return { ok: false, error: 'Приймаю лише фото' };
  var fileName = cleanName(String(req.fileName || ''), 120);
  if (!fileName) return { ok: false, error: 'Порожня назва файлу' };
  var bytes = Utilities.base64Decode(String(req.data || ''));
  if (!bytes.length || bytes.length > MAX_BYTES) return { ok: false, error: 'Порожній або завеликий файл' };
  if (!photosFolderId) return { ok: false, error: 'Не задано PHOTOS_FOLDER_ID у властивостях скрипту' };

  var lock = LockService.getScriptLock();
  lock.waitLock(30000); // два одночасні збереження не створять дві папки однієї машини
  try {
    var photos = DriveApp.getFolderById(photosFolderId);
    var car = findCarFolder(photos, vehicleId) || photos.createFolder(cleanName(vehicleId + ' ' + String(req.vehicleName || ''), 100));
    var sub = kind === 'other' ? null : childFolder(car, KIND_FOLDER[kind]);
    var target = sub || car;
    // повтор після обриву зв'язку: файл з такою назвою вже є — не дублюємо
    var file = existingFile(target, fileName) || target.createFile(Utilities.newBlob(bytes, mime, fileName));
    return {
      ok: true, fileId: file.getId(),
      folderName: sub ? car.getName() + ' / ' + sub.getName() : car.getName(),
      folderUrl: car.getUrl(),
    };
  } finally {
    lock.releaseLock();
  }
}

/** Папка авто: назва починається з номера, далі — не цифра («АВТО-02» не бере «АВТО-021»). */
function findCarFolder(photos, vehicleId) {
  var it = photos.getFolders(), hits = [];
  while (it.hasNext()) {
    var f = it.next();
    var name = String(f.getName()).trim();
    if (!f.isTrashed() && name.indexOf(vehicleId) === 0 && !/^\d/.test(name.slice(vehicleId.length))) hits.push(f);
  }
  hits.sort(function (a, b) { return String(a.getName()).localeCompare(String(b.getName())); });
  return hits[0] || null;
}

function childFolder(parent, name) {
  var it = parent.getFoldersByName(name);
  while (it.hasNext()) { var f = it.next(); if (!f.isTrashed()) return f; }
  return parent.createFolder(name);
}

function existingFile(folder, name) {
  var it = folder.getFilesByName(name);
  while (it.hasNext()) { var f = it.next(); if (!f.isTrashed()) return f; }
  return null;
}

function cleanName(s, max) {
  return s.replace(/[\\/\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function sameString(a, b) {
  if (a.length !== b.length) return false;
  var r = 0;
  for (var i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function json(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
