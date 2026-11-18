// Ядро Telegram-бота «Бази». Без залежностей (Deno і Node): дані — через BotStore, Telegram — через BotTelegram.
//
// Що вміє:
//  • раз на день (за замовчуванням о 9:00 за Києвом) — зведення керівникам з увімкненими нагадуваннями:
//    блокери, «давно не оновлювались» (з кнопками «Без змін» і «Змінити статус»), запчастини, що
//    чекають понад 7 днів, звіти для донорів, що чекають, неоплачене понад 14 днів;
//  • щойно ремонт завершено (з'явилась чернетка звіту) — повідомлення з посиланням на звіт;
//  • будь-кому з команди — «що з хайлюксом?», «021», /cars, /problems, /summary;
//  • керівникам — зміна статусу кнопками, /reports, /team, /add, /remove; нові люди просяться через /start,
//    керівник підключає одним натисканням;
//  • фото: надіслали фото (чи альбом) — бот питає «До якого авто?» (з підписом «021 до» — одразу пропонує
//    папку) і кладе в папку машини на Google Drive через PhotoSink. Документи не приймає: «Фото» бачить уся команда.
// Фінанси бачать лише керівники. VIN, номери, особи, постачальники в повідомлення не потрапляють.

// Збігається з FINAL_STATUSES і STALE_AFTER_DAYS у src/lib/base/format.ts (перевіряє тест).
export const FINAL_STATUSES = ['Готовий', 'Передано частині'];
export const STALE_DAYS = 7;

export type Role = 'head' | 'member';
export interface BotVehicle {
  id: string; name: string; status: string; blocker: string | null; next_step: string | null; responsible: string | null;
  status_updated_at: string; military_unit: string | null; open_jobs: number; parts_waiting: number;
}
export interface WaitingPart { vehicle_id: string; name: string; qty: number; ordered_on: string | null }
export interface PendingPayment { vehicle_id: string | null; amount: number; spent_on: string | null; purpose: string | null }
export interface PendingReport { vehicle_id: string; name: string; created_at: string }
export interface BotUser { telegram_id: number; name: string; role: Role; notify: boolean }

export interface BotStore {
  vehicles(): Promise<BotVehicle[]>;
  waitingParts(): Promise<WaitingPart[]>;
  pendingPayments(): Promise<PendingPayment[]>;
  pendingReports(): Promise<PendingReport[]>;
  vehicleMoney(vehicleId: string): Promise<{ total: number; pending: number }>;
  statuses(): Promise<string[]>;
  setStatus(vehicleId: string, status: string): Promise<void>;
  /** «Без змін»: статус підтверджено, лічильник «давно не оновлювалось» скидається */
  confirmNoChange(vehicleId: string): Promise<void>;
  users(): Promise<BotUser[]>;
  upsertUser(u: BotUser): Promise<void>;
  removeUser(telegramId: number): Promise<void>;
  wasSent(kind: string, ref: string): Promise<boolean>;
  markSent(kind: string, ref: string): Promise<void>;
  /** атомарна позначка «вперше»: true — якщо такої ще не було (і тепер є); false — хтось уже встиг */
  claim(kind: string, ref: string): Promise<boolean>;
  // ----- фото через бота (base_bot_uploads) -----
  /** записати отримане фото; null — це повідомлення вже записане (Telegram повторив оновлення) */
  addUpload(u: NewUpload): Promise<BotUpload | null>;
  /** фото й решта фото того самого альбому (той самий чат і media_group_id), за зростанням id */
  uploadGroup(id: number): Promise<BotUpload[]>;
  /** атомарно взяти в роботу: pending (або saving, що зависло раніше за staleBefore) → saving; повертає взяті id */
  claimUploads(ids: number[], staleBefore: string): Promise<number[]>;
  /** оновити фото; onlyIfStatus — лише ті, що досі в цьому стані */
  updateUploads(ids: number[], patch: UploadPatch, onlyIfStatus?: UploadStatus): Promise<void>;
  // ----- роботи й запчастини з бота (base_bot_drafts) -----
  /** чернетка «додати роботу/запчастину», яку керівник підтверджує кнопкою */
  addDraft(d: NewDraft): Promise<BotDraft>;
  getDraft(id: number): Promise<BotDraft | null>;
  /** атомарно: змінити чернетку, лише якщо вона досі в стані from; null — хтось уже встиг */
  moveDraft(id: number, from: DraftStatus, patch: DraftPatch): Promise<BotDraft | null>;
  addJob(vehicleId: string, description: string): Promise<{ id: number }>;
  /** costTotal — ціна за всю позицію (рішення Олега 18.11.2026) */
  addPart(vehicleId: string, name: string, qty: number, costTotal: number | null, orderedOn: string): Promise<{ id: number }>;
}
export type Button = { text: string; data: string } | { text: string; url: string };
export interface BotTelegram {
  send(chatId: number, html: string, buttons?: Button[][]): Promise<void>;
  /** замінити текст і кнопки вже надісланого повідомлення (питання → результат) */
  edit(chatId: number, messageId: number, html: string, buttons?: Button[][]): Promise<void>;
  answerCallback(callbackId: string, text?: string): Promise<void>;
  /** завантажити файл, надісланий боту (Telegram віддає ботам до 20 МБ) */
  download(fileId: string): Promise<Uint8Array>;
}
export interface BotConfig {
  /** адреса «Штабу» для посилань, напр. https://shtab.tykho.org; порожньо — без посилань */
  appUrl: string;
  /** Telegram ID керівників, які завжди мають доступ і нагадування (напр. Олег) */
  headIds: number[];
  timeZone?: string; digestHour?: number; partsDays?: number; paymentsDays?: number;
  /** куди класти фото (папка авто на Google Drive); без нього бот фото не приймає */
  photoSink?: PhotoSink;
  /** хто може надсилати фото: усі підключені (за замовчуванням) або лише керівники */
  photoUploaders?: 'all' | 'heads';
}

// ----- фото -----
export type UploadKind = 'before' | 'after' | 'other';
export type UploadStatus = 'pending' | 'saving' | 'saved' | 'cancelled';
export interface NewUpload {
  telegram_id: number; chat_id: number; message_id: number; media_group_id: string | null;
  file_id: string; file_name: string | null; mime: string; file_size: number | null; caption: string | null; sent_at: string;
}
export interface BotUpload extends NewUpload {
  id: number; status: UploadStatus; vehicle_id: string | null; kind: UploadKind | null;
  drive_file_id: string | null; error: string | null; updated_at: string;
}
export interface UploadPatch {
  status?: UploadStatus; vehicle_id?: string | null; kind?: UploadKind | null; drive_file_id?: string | null; error?: string | null;
}
export interface SavedPhoto { fileId: string; folderName: string; folderUrl: string }
/** Сховище фото: Apps Script від імені власника папки «Фото» або сервісний акаунт на спільному диску. */
export interface PhotoSink {
  save(p: { vehicleId: string; vehicleName: string; kind: UploadKind; fileName: string; mime: string; bytes: Uint8Array }): Promise<SavedPhoto>;
}

// ----- роботи й запчастини з бота -----
export type DraftKind = 'job' | 'part';
export type DraftStatus = 'pending' | 'saving' | 'done' | 'cancelled';
export interface DraftPayload { text: string; qty: number; cost: number | null }
export interface NewDraft { telegram_id: number; chat_id: number; kind: DraftKind; vehicle_id: string | null; payload: DraftPayload }
export interface BotDraft extends NewDraft { id: number; status: DraftStatus; record_id: number | null; created_at: string }
export interface DraftPatch { status?: DraftStatus; vehicle_id?: string | null; record_id?: number | null }

// мінімальні типи оновлень Telegram
export interface TgUser { id: number; first_name?: string; last_name?: string; username?: string }
export interface TgPhotoSize { file_id: string; file_unique_id?: string; width: number; height: number; file_size?: number }
export interface TgDocument { file_id: string; file_unique_id?: string; file_name?: string; mime_type?: string; file_size?: number }
export interface TgMessage {
  message_id: number; chat: { id: number; type?: string }; from?: TgUser; date?: number; text?: string; caption?: string;
  media_group_id?: string; photo?: TgPhotoSize[]; document?: TgDocument; video?: unknown; video_note?: unknown; animation?: unknown;
}
export interface TgUpdate { update_id?: number; message?: TgMessage; callback_query?: { id: string; from: TgUser; data?: string; message?: TgMessage } }

// ---------- форматування ----------
export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const NB = ' ';
export function money(n: number): string {
  const [i, f] = Math.abs(n).toFixed(2).split('.');
  return `${n < 0 ? '−' : ''}${i.replace(/\B(?=(\d{3})+(?!\d))/g, NB)},${f}${NB}грн`;
}
export function plural(n: number, [one, few, many]: [string, string, string]) {
  const a = Math.abs(n) % 100, b = a % 10;
  return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many;
}
const DAY = 86_400_000;
export const daysSince = (iso: string | null, now: number) => (iso ? Math.floor((now - Date.parse(iso)) / DAY) : 0);
const days = (n: number) => `${n} ${plural(n, ['день', 'дні', 'днів'])}`;
function ago(iso: string, now: number) {
  const d = daysSince(iso, now);
  return d <= 0 ? 'сьогодні' : d === 1 ? 'вчора' : `${days(d)} тому`;
}
const ddmm = (iso: string | null) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}` : '—');
const MAX_LINES = 25;
/** Обрізати рядок так, щоб він вміщався в max байтів UTF-8 (обмеження callback_data у Telegram — 64 байти). */
export function fitBytes(s: string, max: number): string {
  const te = new TextEncoder();
  let out = '';
  for (const ch of s) { if (te.encode(out + ch).length > max) break; out += ch; }
  return out;
}
function capped(lines: string[]) {
  return lines.length > MAX_LINES ? [...lines.slice(0, MAX_LINES), `…і ще ${lines.length - MAX_LINES}`] : lines;
}
/** Дата й година за київським часом (з урахуванням переходу на літній/зимовий час). */
export function localParts(now: number, timeZone = 'Europe/Kyiv') {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(now)).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}
const isFinal = (v: BotVehicle) => FINAL_STATUSES.includes(v.status);
const isStale = (v: BotVehicle, now: number) => !isFinal(v) && daysSince(v.status_updated_at, now) >= STALE_DAYS;

// ---------- пошук машини за вільним текстом ----------
// Кириличні основи марок і моделей → латинські слова з назв (назви в обліку латиницею: «Toyota Hilux (білий)»).
const ALIASES: [string, string][] = [
  ['хайлюк', 'hilux'], ['хайлак', 'hilux'], ['хайлюкс', 'hilux'], ['тойот', 'toyota'], ['тайот', 'toyota'], ['крузер', 'cruiser'], ['ленд', 'land'],
  ['мітсубіс', 'mitsubishi'], ['міцубіс', 'mitsubishi'], ['паджер', 'pajero'], ['л200', 'l200'], ['ел200', 'l200'], ['варіор', 'warrior'], ['ворріор', 'warrior'],
  ['нісан', 'nissan'], ['ніссан', 'nissan'], ['навар', 'navara'], ['патфайндер', 'pathfinder'], ['патфаіндер', 'pathfinder'], ['патрол', 'patrol'],
  ['мерседес', 'mercedes'], ['мерс', 'mercedes'], ['віто', 'vito'], ['віта', 'vito'], ['спринтер', 'sprinter'], ['фольксваген', 'volkswagen'], ['фольц', 'volkswagen'],
  ['транспортер', 'transporter'], ['амарок', 'amarok'], ['крафтер', 'crafter'], ['форд', 'ford'], ['рейнджер', 'ranger'], ['транзит', 'transit'],
  ['ісузу', 'isuzu'], ['сузук', 'suzuki'], ['судзук', 'suzuki'], ['вітар', 'vitara'], ['гранд', 'grand'], ['джимні', 'jimny'], ['вольво', 'volvo'],
  ['ровер', 'rover'], ['дефендер', 'defender'], ['діскавері', 'discovery'], ['рено', 'renault'], ['трафік', 'trafic'], ['мастер', 'master'],
  ['опель', 'opel'], ['віваро', 'vivaro'], ['фіат', 'fiat'], ['дукато', 'ducato'], ['пежо', 'peugeot'], ['сітроен', 'citroen'], ['хюндай', 'hyundai'],
  ['хендай', 'hyundai'], ['кіа', 'kia'], ['соренто', 'sorento'], ['джип', 'jeep'], ['черокі', 'cherokee'], ['шевроле', 'chevrolet'],
];
const STOP = new Set(['що', 'з', 'із', 'зі', 'як', 'там', 'по', 'статус', 'машина', 'машиною', 'машину', 'авто', 'а', 'і', 'й', 'в', 'у', 'на', 'про',
  'мені', 'скажи', 'покажи', 'підкажи', 'нашим', 'наш', 'наша', 'той', 'та', 'ця', 'цей', 'what', 'is', 'the']);
const words = (s: string) => s.toLowerCase().replace(/[«»"'’ʼ`.,!?;:()\[\]{}]/g, ' ').split(/\s+/).filter(Boolean);
/** Слова запиту: кожне — з варіантами (як написано + латинська назва моделі, якщо це відома марка/модель). */
function queryTokens(text: string): string[][] {
  return words(text).filter(w => !STOP.has(w)).map(w => {
    const hit = ALIASES.filter(([stem]) => w.startsWith(stem)).sort((a, b) => b[0].length - a[0].length)[0];
    return hit ? [w, hit[1]] : [w];
  });
}
const LETTERS = /^[a-zа-яіїєґ]+$/;
function tokenMatch(q: string, n: string) {
  if (q === n) return true;
  if (q.length < 3 || n.length < 3) return false;
  if (/^\d+$/.test(q) || /^\d+$/.test(n)) return false; // числа — лише точно: «2008» (рік) не «200» (Land Cruiser 200)
  if (n.startsWith(q) || q.startsWith(n)) return true;
  // українські відмінки: «білим» ~ «білий», «бусом» ~ «бус»; лише для слів з самих літер (не «авто-021»)
  if (!LETTERS.test(q) || !LETTERS.test(n) || !/[а-яіїєґ]/.test(q)) return false;
  const k = Math.min(5, q.length, n.length);
  return k >= 4 && q.slice(0, k - 1) === n.slice(0, k - 1);
}
export function findVehicles(text: string, list: BotVehicle[]): BotVehicle[] {
  const toks = queryTokens(text);
  // «021», «21», «авто 21», «АВТО-021» — пошук за номером
  const numberish = (t: string) => /^\d{1,4}$/.test(t) || /^авто-?\d{1,4}$/.test(t);
  const nums = toks.map(t => t[0]).filter(numberish);
  if (nums.length === 1) {
    // номер важить більше за слова («021 білий»); якщо такого номера немає (напр. рік «2008») — шукаємо за назвою
    const id = `АВТО-${/(\d{1,4})$/.exec(nums[0])![1].padStart(3, '0')}`;
    const hit = list.filter(v => v.id === id);
    if (hit.length || toks.every(t => numberish(t[0]))) return hit;
  }
  const scored = list.map(v => {
    const name = [...words(v.name), ...words(v.id)];
    const score = toks.filter(alts => alts.some(t => name.some(n => tokenMatch(t, n)))).length;
    return { v, score };
  }).filter(x => x.score > 0);
  const best = Math.max(0, ...scored.map(x => x.score));
  return scored.filter(x => x.score === best).map(x => x.v);
}

// ---------- фото: тип файлу, підпис, назва на Drive ----------
/** Підпапки в папці авто (так само їх розпізнає вкладка «Фото» і звіт для донорів: «до»/«після»). */
export const KIND_FOLDER: Record<'before' | 'after', string> = { before: 'До ремонту', after: 'Після ремонту' };
const KIND_CODE: Record<UploadKind, string> = { before: 'b', after: 'a', other: 'n' };
const CODE_KIND: Record<string, UploadKind> = { b: 'before', a: 'after', n: 'other' };
const kindLabel = (k: UploadKind) => (k === 'other' ? 'просто в папку машини' : `у «${KIND_FOLDER[k]}»`);
const kindShort = (k: UploadKind) => (k === 'before' ? 'до ремонту' : k === 'after' ? 'після ремонту' : 'без підпапки');
/** Більші файли Telegram ботам не віддає. */
export const MAX_PHOTO_BYTES = 20 * 1024 * 1024;
/** «Зберігаю…», що зависло довше (функцію перервали), можна запустити знову. */
const STALE_SAVING_MS = 5 * 60_000;
const MIME_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic', 'image/heif': 'heif', 'image/webp': 'webp', 'image/gif': 'gif', 'image/tiff': 'tif', 'image/bmp': 'bmp' };
const EXT_MIME: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', heic: 'image/heic', heif: 'image/heif', webp: 'image/webp', gif: 'image/gif', tif: 'image/tiff', tiff: 'image/tiff', bmp: 'image/bmp' };
const extOf = (name: string | null | undefined) => /\.([a-z0-9]{2,5})$/i.exec(name ?? '')?.[1].toLowerCase();

export type Media =
  | { ok: true; file_id: string; mime: string; file_name: string | null; file_size: number | null }
  | { ok: false; reason: 'not-image' | 'too-big' | 'video' };
/** Що в повідомленні: фото (найбільший розмір), зображення файлом — так; інші документи, відео — ні. */
export function mediaOf(m: TgMessage): Media | null {
  if (m.photo?.length) {
    const best = [...m.photo].sort((a, b) => b.width * b.height - a.width * a.height || (b.file_size ?? 0) - (a.file_size ?? 0))[0];
    return { ok: true, file_id: best.file_id, mime: 'image/jpeg', file_name: null, file_size: best.file_size ?? null };
  }
  if (m.document) {
    const d = m.document;
    let mime = (d.mime_type ?? '').toLowerCase();
    const ext = extOf(d.file_name);
    if ((!mime || mime === 'application/octet-stream') && ext && EXT_MIME[ext]) mime = EXT_MIME[ext];
    if (!mime.startsWith('image/') || mime === 'image/svg+xml') return { ok: false, reason: 'not-image' };
    if ((d.file_size ?? 0) > MAX_PHOTO_BYTES) return { ok: false, reason: 'too-big' };
    return { ok: true, file_id: d.file_id, mime, file_name: d.file_name ?? null, file_size: d.file_size ?? null };
  }
  if (m.video || m.video_note || m.animation) return { ok: false, reason: 'video' };
  return null;
}

/** Підпис до фото: «021 до», «хайлюкс після ремонту», «до ремонту 25». «до» посеред фрази («фото до хайлюкса») —
 *  прийменник, а не «до ремонту». */
export function parseCaption(caption: string, list: BotVehicle[]): { vehicles: BotVehicle[]; kind: UploadKind | null } {
  const ws = words(caption);
  let kind: UploadKind | null = null;
  const rest: string[] = [];
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i], next = ws[i + 1];
    const repairNext = !!next && /^ремонт/.test(next);
    if (/^(після|пiсля|после|after)$/.test(w)) { kind = 'after'; if (repairNext) i++; continue; }
    if (w === 'before' || (w === 'до' && (next === undefined || repairNext))) { kind = 'before'; if (repairNext) i++; continue; }
    rest.push(w);
  }
  return { vehicles: rest.length ? findVehicles(rest.join(' '), list) : [], kind };
}

/** Назва файлу на Drive: дата надсилання (за Києвом), номер авто, номер запису — повтор не створює копію. */
export function uploadFileName(u: Pick<BotUpload, 'id' | 'mime' | 'file_name' | 'sent_at'>, vehicleId: string, timeZone = 'Europe/Kyiv') {
  const fromName = extOf(u.file_name);
  const ext = MIME_EXT[u.mime] ?? (fromName && EXT_MIME[fromName] ? fromName : 'jpg');
  return `${localParts(Date.parse(u.sent_at), timeZone).date}_${vehicleId}_${u.id}.${ext}`;
}
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

// ---------- роботи й запчастини текстом: «021 робота Заміна ГРМ», «021 запчастина Ремінь ГРМ 2 шт 4900 грн» ----------
const JOB_WORDS = new Set(['робота', 'роботу', 'job']);
const PART_WORDS = new Set(['запчастина', 'запчастину', 'деталь', 'part']);
const normWord = (t: string) => t.toLowerCase().replace(/^[«"'(\[]+|[»"'):,.;!\]]+$/g, '');
export interface AddCommand { kind: DraftKind; vehicles: BotVehicle[]; vehicleQuery: string; text: string; qty: number; cost: number | null; problem: string | null; atStart: boolean }
/** Розбір команди керівника. null — це не команда додавання (питання, пошук машини тощо).
 *  Форми: «021 робота …», «хайлюкс запчастина …», «робота 021 …», «/job 021 …», «/part 021 …».
 *  Для запчастини: кількість «2 шт» / «×2», ціна «4900 грн» або «4 900 грн» — за всю позицію. */
export function parseAddCommand(raw: string, list: BotVehicle[]): AddCommand | null {
  const text = raw.trim();
  if (!text || text.endsWith('?')) return null;
  const tokens = text.split(/\s+/);
  let kind: DraftKind | null = null, kw = -1;
  const cmd = /^\/(job|part)(?:@\w+)?$/i.exec(tokens[0]);
  if (cmd) { kind = cmd[1].toLowerCase() === 'job' ? 'job' : 'part'; kw = 0; }
  else {
    for (let i = 0; i < Math.min(tokens.length, 6); i++) {
      const n = normWord(tokens[i]);
      if (JOB_WORDS.has(n)) { kind = 'job'; kw = i; break; }
      if (PART_WORDS.has(n)) { kind = 'part'; kw = i; break; }
    }
  }
  if (!kind) return null;
  const vehicleQuery = kw === 0 ? (tokens[1] ?? '') : tokens.slice(0, kw).join(' ');
  let body = (kw === 0 ? tokens.slice(2) : tokens.slice(kw + 1)).join(' ');
  const vehicles = vehicleQuery ? findVehicles(vehicleQuery, list) : [];
  let qty = 1, cost: number | null = null;
  const cut = (m: RegExpExecArray) => (body.slice(0, m.index) + ' ' + body.slice(m.index + m[0].length)).trim();
  if (kind === 'part') {
    const q = /(?:^|\s)(\d+(?:[.,]\d+)?)\s*(?:шт|штук|штуки|штука|pcs)\.?(?=\s|$)|(?:^|\s)[x×х]\s?(\d+)(?=\s|$)/i.exec(body);
    if (q) { qty = Number((q[1] ?? q[2]).replace(',', '.')); body = cut(q); }
    const p = /(?:^|\s)(\d{1,3}(?:[ \u00a0]\d{3})+|\d+)(?:[.,](\d{1,2}))?\s*(?:грн|гривень|гривні|гривня|₴|uah)\.?(?=\s|$)/i.exec(body);
    if (p) { cost = Number(p[1].replace(/[ \u00a0]/g, '') + (p[2] ? `.${p[2]}` : '')); body = cut(p); }
  }
  body = body.replace(/\s+/g, ' ').replace(/^[\s:—–-]+|[\s,;:—–-]+$/g, '').trim();
  let problem: string | null = null;
  if (!body) problem = kind === 'job' ? 'Опишіть роботу, наприклад: «021 робота Заміна ременя ГРМ».' : 'Вкажіть назву запчастини, наприклад: «021 запчастина Ремінь ГРМ 2 шт».';
  else if (body.length > 300) problem = 'Задовгий опис — до 300 символів.';
  else if (!(qty > 0 && qty <= 10000)) problem = 'Кількість має бути від 1 до 10 000.';
  return { kind, vehicles, vehicleQuery, text: body, qty, cost, problem, atStart: kw === 0 };
}
/** Чернетка старша за добу не підтверджується: випадкове натискання на старе повідомлення нічого не додасть. */
const DRAFT_TTL_MS = 24 * 3600_000;

// ---------- тексти ----------
function card(v: BotVehicle, now: number, role: Role, moneyLine: string | null) {
  const lines = [
    `<b>${esc(v.name)}</b> · ${esc(v.id)}`,
    `Статус: <b>${esc(v.status)}</b> · оновлено ${ago(v.status_updated_at, now)}${isStale(v, now) ? ' (давно без оновлення)' : ''}`,
    `Блокер: ${v.blocker ? esc(v.blocker) : 'нічого не блокує'}`,
    `Що далі: ${v.next_step ? esc(v.next_step) : 'не вказано'}`,
    `Відповідальний: ${v.responsible ? esc(v.responsible) : 'не призначено'}`,
    `Відкритих робіт: ${v.open_jobs} · запчастин чекаємо: ${v.parts_waiting}`,
  ];
  if (role === 'head' && moneyLine) lines.push(moneyLine);
  return lines.join('\n');
}
const HELP_MEMBER = [
  'Я бот обліку авто СТО «База». Що можна спитати:',
  '— «що з хайлюксом?», «021» або назву машини — статус, блокер, що далі;',
  '— /cars — машини в роботі;',
  '— /problems — що застрягло;',
  '— /summary — коротке зведення.',
];
const HELP_HEAD = [
  'Для координатора:',
  '— кнопки під карткою машини: «Без змін» і «Змінити статус»;',
  '— «021 робота Заміна ременя ГРМ» — додати роботу (перепитаю кнопкою);',
  '— «021 запчастина Ремінь ГРМ 2 шт 4900 грн» — додати запчастину; ціна — за всю позицію;',
  '— /reports — звіти для донорів, що чекають;',
  '— /team — хто підключений; /add ID роль ім\'я; /remove ID.',
  'Щодня о 9:00 надсилаю зведення: блокери, що давно не оновлювалось, запчастини, звіти, неоплачене.',
];
const HELP_PHOTOS = '— надішліть фото (можна альбомом) — спитаю, до якого авто, і покладу в папку машини на Google Drive; з підписом «021 до» чи «хайлюкс після» — одразу запропоную папку.';
const MSG_NOT_IMAGE = 'Документи через бота не зберігаю — лише фото. Папку «Фото» бачить уся команда, а в рахунках і актах бувають суми та особисті дані.';
const MSG_TOO_BIG = 'Файл більший за 20 МБ — Telegram не віддає ботам такі файли. Надішліть його як фото (не файлом) або покладіть у папку авто на Google Drive вручну.';
const MSG_VIDEO = 'Відео я не зберігаю — лише фото. Відео покладіть у папку авто на Google Drive вручну.';
const MSG_NO_SINK = 'Фото через бота ще не налаштовані. Поки що кладіть їх у папку авто на Google Drive.';
const MSG_HEADS_ONLY = 'Фото через бота приймає лише координатор. Покладіть фото в папку авто на Google Drive або передайте координатору.';

// ---------- бот ----------
export function createBaseBot(store: BotStore, tg: BotTelegram, cfg: BotConfig, clock: () => number = () => Date.now()) {
  const tz = cfg.timeZone ?? 'Europe/Kyiv';
  const digestHour = cfg.digestHour ?? 9, partsDays = cfg.partsDays ?? 7, paymentsDays = cfg.paymentsDays ?? 14;
  const link = (path: string) => (cfg.appUrl ? `${cfg.appUrl.replace(/\/$/, '')}${path}` : null);
  const carUrl = (id: string, tab?: string) => link(`/base/car/?id=${encodeURIComponent(id)}${tab ? `&tab=${tab}` : ''}`);
  const sink = cfg.photoSink;
  const canUpload = (u: BotUser) => !!sink && (cfg.photoUploaders !== 'heads' || u.role === 'head');
  /** відповідь на натискання кнопки; помилка (запит застарів) не має зривати решту дії */
  const answer = (id: string, text?: string) => tg.answerCallback(id, text).catch(() => undefined);

  async function userOf(id: number): Promise<BotUser | null> {
    const list = await store.users();
    const u = list.find(x => x.telegram_id === id);
    if (cfg.headIds.includes(id)) return { telegram_id: id, name: u?.name ?? 'Координатор', role: 'head', notify: true };
    return u ?? null;
  }
  async function heads(onlyNotify: boolean): Promise<BotUser[]> {
    const list = await store.users();
    const map = new Map<number, BotUser>();
    for (const u of list) if (u.role === 'head' && (!onlyNotify || u.notify)) map.set(u.telegram_id, u);
    for (const id of cfg.headIds) map.set(id, { telegram_id: id, name: map.get(id)?.name ?? 'Координатор', role: 'head', notify: true });
    return [...map.values()];
  }
  async function moneyLine(id: string) {
    const m = await store.vehicleMoney(id);
    return m.total ? `Витрачено: ${money(m.total)}${m.pending ? ` · очікує оплати: ${money(m.pending)}` : ''}` : null;
  }
  async function sendCard(chat: number, v: BotVehicle, u: BotUser) {
    const now = clock();
    const buttons: Button[][] = [];
    if (u.role === 'head' && !isFinal(v)) buttons.push([{ text: 'Без змін', data: `ok:${v.id}` }, { text: 'Змінити статус', data: `st:${v.id}` }]);
    else if (u.role === 'head') buttons.push([{ text: 'Змінити статус', data: `st:${v.id}` }]);
    const url = carUrl(v.id);
    if (url) buttons.push([{ text: 'Відкрити в «Штабі»', url }]);
    await tg.send(chat, card(v, now, u.role, u.role === 'head' ? await moneyLine(v.id) : null), buttons.length ? buttons : undefined);
  }

  // ----- зведення -----
  async function buildDigest(role: Role): Promise<{ html: string; buttons: Button[][] } | null> {
    const now = clock();
    const [vs, parts, reports, pays] = await Promise.all([store.vehicles(), store.waitingParts(), store.pendingReports(), role === 'head' ? store.pendingPayments() : Promise.resolve([])]);
    const byId = new Map(vs.map(v => [v.id, v]));
    const active = vs.filter(v => !isFinal(v));
    const blocked = active.filter(v => v.blocker);
    const stale = active.filter(v => isStale(v, now) && !v.blocker);
    const lateParts = parts.filter(p => p.ordered_on && daysSince(p.ordered_on, now) >= partsDays);
    const latePays = pays.filter(p => p.spent_on && daysSince(p.spent_on, now) >= paymentsDays);
    if (!blocked.length && !stale.length && !lateParts.length && !reports.length && !latePays.length) return null;
    const out: string[] = [`<b>СТО «База» · зведення на ${ddmm(localParts(now, tz).date)}</b>`,
      `В роботі: ${active.length} · з блокером: ${blocked.length} · давно без оновлення: ${active.filter(v => isStale(v, now)).length}`];
    if (blocked.length) out.push('', '<b>Блокери</b>', ...capped(blocked.map(v => `— ${esc(v.name)} (${esc(v.id)}): ${esc(v.blocker!)} · без змін ${days(Math.max(0, daysSince(v.status_updated_at, now)))}`)));
    if (stale.length) out.push('', `<b>Давно не оновлювались (${STALE_DAYS}+ днів)</b>`, ...capped(stale.map(v => `— ${esc(v.name)} (${esc(v.id)}): ${esc(v.status)} · ${days(daysSince(v.status_updated_at, now))}`)));
    if (lateParts.length) out.push('', `<b>Запчастини чекаємо понад ${partsDays} днів</b>`, ...capped(lateParts.map(p => `— ${esc(p.name)} × ${p.qty} для ${esc(byId.get(p.vehicle_id)?.name ?? p.vehicle_id)} · замовлено ${ddmm(p.ordered_on)} (${days(daysSince(p.ordered_on, now))})`)));
    if (reports.length) out.push('', '<b>Звіти для донорів чекають</b>', ...capped(reports.map(r => `— ${esc(r.name)} (${esc(r.vehicle_id)}): ремонт завершено, звіт не сформовано`)));
    if (latePays.length) {
      const total = latePays.reduce((a, p) => a + Math.round(p.amount * 100), 0) / 100;
      out.push('', `<b>Очікує оплати понад ${paymentsDays} днів: ${money(total)}</b>`,
        ...capped(latePays.sort((a, b) => b.amount - a.amount).map(p => `— ${money(p.amount)} · ${esc(p.purpose ?? 'без опису')}${p.vehicle_id ? ` (${esc(byId.get(p.vehicle_id)?.name ?? p.vehicle_id)})` : ''} · з ${ddmm(p.spent_on)}`)));
    }
    // кнопки лише для машин без оновлення: одним натисканням підтвердити або змінити статус
    const buttons: Button[][] = role === 'head' ? stale.slice(0, 10).map(v => [
      { text: `${v.id}: без змін`, data: `ok:${v.id}` }, { text: `${v.id}: статус…`, data: `st:${v.id}` },
    ]) : [];
    const url = link('/base/');
    if (url) buttons.push([{ text: 'Відкрити зведення в «Штабі»', url }]);
    return { html: out.join('\n'), buttons };
  }

  /** «Ремонт завершено — чернетка звіту готова»: кожну чернетку повідомляємо один раз. */
  async function notifyReports(): Promise<number> {
    const recipients = await heads(true);
    let notices = 0;
    for (const r of await store.pendingReports()) {
      const ref = `${r.vehicle_id}@${r.created_at}`;
      if (await store.wasSent('report-ready', ref)) continue;
      const url = carUrl(r.vehicle_id, 'report');
      for (const u of recipients) {
        await tg.send(u.telegram_id, `<b>Ремонт завершено: ${esc(r.name)}</b> (${esc(r.vehicle_id)})\nЧернетка звіту для донорів уже готова. Перевірте історію, витрати й фото і сформуйте PDF.`,
          url ? [[{ text: 'Відкрити звіт', url }]] : undefined);
      }
      await store.markSent('report-ready', ref);
      notices++;
    }
    return notices;
  }

  /** Викликати щогодини (pg_cron → base-reminders). Повторно в той самий день зведення не надсилає. */
  async function runScheduled(): Promise<{ digest: boolean; reportNotices: number }> {
    const now = clock();
    const recipients = await heads(true);
    const notices = await notifyReports();
    const { date, hour } = localParts(now, tz);
    let digest = false;
    if (hour >= digestHour && !(await store.wasSent('digest', date))) {
      for (const u of recipients) {
        const d = await buildDigest(u.role);
        if (d) { await tg.send(u.telegram_id, d.html, d.buttons.length ? d.buttons : undefined); digest = true; }
      }
      await store.markSent('digest', date);
    }
    return { digest, reportNotices: notices };
  }

  // ----- повідомлення й кнопки -----
  async function onUnknown(m: TgMessage, from: TgUser) {
    const name = [from.first_name, from.last_name].filter(Boolean).join(' ') || from.username || `ID ${from.id}`;
    await tg.send(m.chat.id, `Це бот обліку авто СТО «База». Щоб бачити машини, вас має підключити координатор.\nВаш Telegram ID: <code>${from.id}</code>\nЗапит я вже надіслав.`);
    if (await store.wasSent('join', String(from.id))) return;
    for (const h of await heads(false)) {
      await tg.send(h.telegram_id, `<b>Запит на доступ до бота «Бази»</b>\n${esc(name)}${from.username ? ` (@${esc(from.username)})` : ''}, ID <code>${from.id}</code>`,
        [[{ text: 'Підключити до команди', data: fitBytes(`add:${from.id}:${name.replace(/:/g, ' ')}`, 64) }, { text: 'Ігнорувати', data: `ign:${from.id}` }]]);
    }
    await store.markSent('join', String(from.id));
  }

  async function onText(m: TgMessage, u: BotUser) {
    const raw = (m.text ?? '').trim();
    const cmd = /^\/([a-z_]+)(?:@\w+)?\s*(.*)$/i.exec(raw);
    const c = cmd?.[1].toLowerCase();
    const arg = cmd?.[2]?.trim() ?? '';
    const lower = raw.toLowerCase();
    const chat = m.chat.id;
    const now = clock();
    if (c === 'start' || c === 'help' || lower === 'допомога') {
      return tg.send(chat, [...HELP_MEMBER, ...(canUpload(u) ? [HELP_PHOTOS] : []), ...(u.role === 'head' ? ['', ...HELP_HEAD] : [])].join('\n'));
    }
    if (c === 'cars' || ['авто', 'машини', 'список'].includes(lower)) {
      const vs = await store.vehicles();
      const active = vs.filter(v => !isFinal(v));
      const ready = vs.filter(v => v.status === 'Готовий');
      const lines = active.map(v => `— ${esc(v.id)} ${esc(v.name)}: ${esc(v.status)}${v.blocker ? ' · є блокер' : ''}${isStale(v, now) ? ' · давно без оновлення' : ''}`);
      return tg.send(chat, [`<b>В роботі: ${active.length}</b>`, ...capped(lines), ...(ready.length ? ['', `Готові до передачі: ${ready.map(v => esc(v.name)).join(', ')}`] : []),
        '', 'Напишіть назву або номер машини, щоб побачити подробиці.'].join('\n'));
    }
    if (c === 'problems' || ['проблеми', 'блокери'].includes(lower)) {
      const vs = (await store.vehicles()).filter(v => !isFinal(v));
      const blocked = vs.filter(v => v.blocker), stale = vs.filter(v => isStale(v, now) && !v.blocker);
      if (!blocked.length && !stale.length) return tg.send(chat, 'Усе рухається: блокерів і застарілих статусів немає.');
      const sections: string[] = [];
      if (blocked.length) sections.push(['<b>Блокери</b>', ...capped(blocked.map(v => `— ${esc(v.name)}: ${esc(v.blocker!)}`))].join('\n'));
      if (stale.length) sections.push(['<b>Давно не оновлювались</b>', ...capped(stale.map(v => `— ${esc(v.name)}: ${esc(v.status)} · ${days(daysSince(v.status_updated_at, now))}`))].join('\n'));
      return tg.send(chat, sections.join('\n\n'));
    }
    if (c === 'summary' || lower === 'зведення') {
      const vs = await store.vehicles();
      const by = new Map<string, number>();
      for (const v of vs) by.set(v.status, (by.get(v.status) ?? 0) + 1);
      const lines = [`<b>Зведення</b>`, `Усього авто: ${vs.length} · в роботі: ${vs.filter(v => !isFinal(v)).length}`, ...[...by].map(([s, n]) => `— ${esc(s)}: ${n}`)];
      if (u.role === 'head') {
        const pays = await store.pendingPayments();
        const total = pays.reduce((a, p) => a + Math.round(p.amount * 100), 0) / 100;
        if (total) lines.push('', `Очікує оплати: ${money(total)}`);
      }
      return tg.send(chat, lines.join('\n'));
    }
    if (c === 'reports' || lower === 'звіти') {
      if (u.role !== 'head') return tg.send(chat, 'Звіти для донорів доступні лише координатору.');
      const rs = await store.pendingReports();
      if (!rs.length) return tg.send(chat, 'Усі звіти для донорів сформовано.');
      return tg.send(chat, ['<b>Звіти для донорів чекають</b>', ...capped(rs.map(r => `— ${esc(r.name)} (${esc(r.vehicle_id)})`))].join('\n'),
        rs.slice(0, 8).flatMap(r => { const url = carUrl(r.vehicle_id, 'report'); return url ? [[{ text: `Звіт: ${r.name}`.slice(0, 60), url }]] : []; }));
    }
    if (c === 'team' || c === 'add' || c === 'remove') {
      if (u.role !== 'head') return tg.send(chat, 'Керувати командою може лише координатор.');
      if (c === 'team') {
        const list = await store.users();
        return tg.send(chat, ['<b>Підключені до бота</b>', ...list.map(x => `— ${esc(x.name)} · ${x.role === 'head' ? 'керівник' : 'команда'}${x.notify ? ' · нагадування' : ''} · <code>${x.telegram_id}</code>`),
          ...cfg.headIds.filter(id => !list.some(x => x.telegram_id === id)).map(id => `— координатор (з налаштувань) · <code>${id}</code>`)].join('\n'));
      }
      if (c === 'add') {
        const mm = /^(\d{4,15})\s+(керівник|head|команда|member)\s+(.{1,60})$/i.exec(arg);
        if (!mm) return tg.send(chat, 'Формат: /add 123456789 команда Іван Петренко (роль: команда або керівник)');
        const role: Role = /^(керівник|head)$/i.test(mm[2]) ? 'head' : 'member';
        await store.upsertUser({ telegram_id: Number(mm[1]), name: mm[3].trim(), role, notify: false });
        await tg.send(Number(mm[1]), 'Вас підключено до бота обліку авто СТО «База». Напишіть /help, щоб побачити, що я вмію.').catch(() => undefined);
        return tg.send(chat, `Підключено: ${esc(mm[3].trim())} (${role === 'head' ? 'керівник' : 'команда'}).`);
      }
      const id = Number(/^\d{4,15}$/.exec(arg)?.[0]);
      if (!id) return tg.send(chat, 'Формат: /remove 123456789');
      if (cfg.headIds.includes(id)) return tg.send(chat, 'Цього координатора задано в налаштуваннях бота, його звідси не видалити.');
      await store.removeUser(id);
      return tg.send(chat, `Відключено: ${id}.`);
    }
    // «021 робота …», «021 запчастина …», /job, /part
    if (c === 'job' || c === 'part' || !c) {
      const vs = await store.vehicles();
      const add = parseAddCommand(raw, vs);
      // без машини і не з початку фрази («яка робота лишилась по хайлюксу») — це скоріше питання: шукаємо машину
      if (add && (c || add.vehicles.length || add.atStart)) return onAddCommand(chat, u, add, !!c);
    }
    if (c) return tg.send(chat, 'Не знаю такої команди. /help — що я вмію.');
    // вільний текст — пошук машини
    const found = findVehicles(raw, await store.vehicles());
    if (found.length === 1) return sendCard(chat, found[0], u);
    if (found.length > 1) {
      return tg.send(chat, `Знайшов ${found.length} ${plural(found.length, ['машину', 'машини', 'машин'])}. Яку саме?`,
        found.slice(0, 8).map(v => [{ text: `${v.id} ${v.name}`.slice(0, 60), data: `car:${v.id}` }]));
    }
    return tg.send(chat, `Не знайшов машину «${esc(raw.slice(0, 60))}». Напишіть номер, наприклад 021, або /cars — список.`);
  }

  // ----- роботи й запчастини з бота -----
  const KIND_WORD: Record<DraftKind, string> = { job: 'роботу', part: 'запчастину' };
  function draftLine(kind: DraftKind, p: DraftPayload) {
    return kind === 'job' ? `Робота: «${esc(p.text)}»`
      : `Запчастина: «${esc(p.text)}» · ${p.qty} шт${p.cost != null ? ` · вартість позиції ${money(p.cost)}` : ''}`;
  }
  const confirmButtons = (id: number): Button[][] => [[{ text: 'Додати', data: `ad:${id}` }, { text: 'Скасувати', data: `ax:${id}` }]];

  async function onAddCommand(chat: number, u: BotUser, add: AddCommand, explicit: boolean) {
    if (u.role !== 'head') return tg.send(chat, 'Додавати роботи й запчастини може лише координатор.');
    if (add.problem) return tg.send(chat, add.problem);
    if (!add.vehicles.length) {
      return tg.send(chat, add.vehicleQuery
        ? `Не знайшов машину «${esc(add.vehicleQuery.slice(0, 40))}». Почніть з номера: «021 ${add.kind === 'job' ? 'робота Заміна ременя ГРМ' : 'запчастина Ремінь ГРМ 2 шт'}».`
        : `Вкажіть машину: «${explicit ? `/${add.kind} 021 …` : `021 ${add.kind === 'job' ? 'робота' : 'запчастина'} …`}».`);
    }
    const one = add.vehicles.length === 1 ? add.vehicles[0] : null;
    const d = await store.addDraft({ telegram_id: u.telegram_id, chat_id: chat, kind: add.kind, vehicle_id: one?.id ?? null, payload: { text: add.text, qty: add.qty, cost: add.cost } });
    if (one) return tg.send(chat, [`Додати ${KIND_WORD[add.kind]}?`, `<b>${esc(one.name)}</b> (${esc(one.id)})`, draftLine(add.kind, d.payload)].join('\n'), confirmButtons(d.id));
    return tg.send(chat, [`Додати ${KIND_WORD[add.kind]} — до якої машини?`, draftLine(add.kind, d.payload)].join('\n'),
      [...add.vehicles.slice(0, 8).map(v => [{ text: `${v.id} ${v.name}`.slice(0, 60), data: `av:${d.id}:${v.id}` }]), [{ text: 'Скасувати', data: `ax:${d.id}` }]]);
  }

  async function onDraftCallback(q: NonNullable<TgUpdate['callback_query']>, u: BotUser, kind: string, parts: string[]) {
    if (u.role !== 'head') return answer(q.id, 'Додавати роботи й запчастини може лише координатор');
    const chat = q.message?.chat.id ?? q.from.id;
    const id = Number(parts[1]);
    const d = Number.isSafeInteger(id) && id > 0 ? await store.getDraft(id) : null;
    if (!d || d.chat_id !== chat) return answer(q.id, 'Чернетку не знайдено');
    if (d.status === 'done') return answer(q.id, 'Уже додано');
    if (d.status === 'cancelled') return answer(q.id, 'Скасовано раніше');
    if (d.status === 'saving') return answer(q.id, 'Уже додаю…');
    if (clock() - Date.parse(d.created_at) > DRAFT_TTL_MS) {
      await store.moveDraft(d.id, 'pending', { status: 'cancelled' });
      await answer(q.id, 'Застаріло');
      return replace(q, 'Це повідомлення старше доби — нічого не додано. Надішліть ще раз, якщо треба.');
    }
    if (kind === 'ax') {
      if (!(await store.moveDraft(d.id, 'pending', { status: 'cancelled' }))) return answer(q.id, 'Уже змінено');
      await answer(q.id, 'Скасовано');
      return replace(q, 'Скасовано — нічого не додано.');
    }
    const vs = await store.vehicles();
    if (kind === 'av') {
      const v = vs.find(x => x.id === parts[2]);
      if (!v) return answer(q.id, 'Цієї машини вже немає в обліку');
      const moved = await store.moveDraft(d.id, 'pending', { vehicle_id: v.id });
      if (!moved) return answer(q.id, 'Уже змінено');
      await answer(q.id);
      return replace(q, [`Додати ${KIND_WORD[d.kind]}?`, `<b>${esc(v.name)}</b> (${esc(v.id)})`, draftLine(d.kind, d.payload)].join('\n'), confirmButtons(d.id));
    }
    // ad — додати
    const v = vs.find(x => x.id === d.vehicle_id);
    if (!v) return answer(q.id, d.vehicle_id ? 'Цієї машини вже немає в обліку' : 'Спершу оберіть машину');
    if (!(await store.moveDraft(d.id, 'pending', { status: 'saving' }))) return answer(q.id, 'Уже додаю…');
    await answer(q.id, 'Додаю…');
    try {
      const r = d.kind === 'job'
        ? await store.addJob(v.id, d.payload.text)
        : await store.addPart(v.id, d.payload.text, d.payload.qty, d.payload.cost, localParts(clock(), tz).date);
      await store.moveDraft(d.id, 'saving', { status: 'done', record_id: r.id });
      const url = carUrl(v.id, d.kind === 'job' ? undefined : 'parts');
      return replace(q, [`Додано до <b>${esc(v.name)}</b> (${esc(v.id)}):`, draftLine(d.kind, d.payload), d.kind === 'job' ? 'Статус: заплановано.' : 'Статус: замовлено.'].join('\n'),
        url ? [[{ text: 'Відкрити картку', url }]] : undefined);
    } catch (e) {
      await store.moveDraft(d.id, 'saving', { status: 'pending' }).catch(() => undefined);
      return replace(q, [`Не вдалося додати: ${esc(errText(e))}`, `<b>${esc(v.name)}</b> (${esc(v.id)})`, draftLine(d.kind, d.payload)].join('\n'),
        [[{ text: 'Спробувати ще раз', data: `ad:${d.id}` }, { text: 'Скасувати', data: `ax:${d.id}` }]]);
    }
  }

  // ----- фото -----
  type CB = NonNullable<TgUpdate['callback_query']>;
  type Hint = { vehicles: BotVehicle[]; kind: UploadKind | null };
  const carBtn = (uid: number, v: BotVehicle, k: UploadKind | null, suffix = ''): Button =>
    ({ text: `${v.id} ${v.name}${suffix}`.slice(0, 60), data: k ? `us:${uid}:${v.id}:${KIND_CODE[k]}` : `uv:${uid}:${v.id}` });
  const kindRows = (uid: number, v: BotVehicle): Button[][] => [
    [{ text: KIND_FOLDER.before, data: `us:${uid}:${v.id}:b` }, { text: KIND_FOLDER.after, data: `us:${uid}:${v.id}:a` }],
    [{ text: 'Просто в папку машини', data: `us:${uid}:${v.id}:n` }],
  ];
  const otherRow = (uid: number, label = 'Інше авто'): Button[] => [{ text: label, data: `ua:${uid}` }, { text: 'Скасувати', data: `ux:${uid}` }];
  const isOpen = (g: BotUpload, now: number) => g.status === 'pending' || (g.status === 'saving' && Date.parse(g.updated_at) < now - STALE_SAVING_MS);
  const closedReason = (group: BotUpload[]) =>
    group.some(g => g.status === 'saving') ? 'Уже зберігаю…' : group.every(g => g.status === 'cancelled') ? 'Ці фото скасовано' : 'Ці фото вже збережено';

  /** питання «До якого авто?»; followUp — уточнення, коли підпис альбому прийшов не з першим фото */
  async function askVehicle(chat: number, up: BotUpload, caption: string | null, hint: Hint | null, list: BotVehicle[], followUp: boolean) {
    const uid = up.id, album = !!up.media_group_id;
    const cap = caption ? `«${esc(caption.slice(0, 80))}»` : '';
    const head = followUp ? `Підпис до цього альбому: ${cap}.` : `Отримав ${album ? 'фото (альбом)' : 'фото'}.${cap ? ` Підпис: ${cap}.` : ''}`;
    const vs = hint?.vehicles ?? [], k = hint?.kind ?? null;
    if (vs.length === 1) {
      const v = vs[0];
      if (k) return tg.send(chat, `${head}\nЗберегти в <b>${esc(v.name)}</b> (${esc(v.id)}), ${kindLabel(k)}?`,
        [[{ text: `Зберегти: ${v.id} · ${kindShort(k)}`, data: `us:${uid}:${v.id}:${KIND_CODE[k]}` }], otherRow(uid)]);
      return tg.send(chat, `${head}\n<b>${esc(v.name)}</b> (${esc(v.id)}). У яку папку?`, [...kindRows(uid, v), otherRow(uid)]);
    }
    const into = k ? ` Збережу ${kindLabel(k)}.` : '';
    if (vs.length > 1) {
      return tg.send(chat, `${head}\nПідходить кілька машин. Яка?${into}`, [...vs.slice(0, 8).map(v => [carBtn(uid, v, k)]), otherRow(uid, 'Усі машини…')]);
    }
    // нічого не впізнали: машини, що нещодавно оновлювались, + повний список
    const recent = list.filter(v => !isFinal(v)).sort((a, b) => Date.parse(b.status_updated_at) - Date.parse(a.status_updated_at)).slice(0, 6);
    return tg.send(chat, [
      `${head}${caption ? ' Номера чи назви машини в підписі не знайшов.' : ''}`,
      `До якого авто ${album ? 'ці фото' : 'це фото'}?${into}`,
      'Порада: з підписом «021 до» чи «хайлюкс після» я одразу запропоную потрібну папку.',
    ].join('\n'), [...recent.map(v => [carBtn(uid, v, k)]), otherRow(uid, 'Усі машини…')]);
  }

  async function onMedia(m: TgMessage, u: BotUser, media: Media) {
    const chat = m.chat.id;
    // відмова на альбом — одна, а не на кожне фото чи файл альбому
    const refuse = async (html: string) => {
      if (m.media_group_id && !(await store.claim('album-reply', `${chat}:${m.media_group_id}`))) return;
      await tg.send(chat, html);
    };
    if (!media.ok) {
      if (media.reason === 'not-image') {
        return refuse(`${MSG_NOT_IMAGE} ${u.role === 'head' ? 'Документ додайте в картку авто в «Штабі».' : 'Документ передайте координатору або додайте в картку авто в «Штабі».'}`);
      }
      return refuse(media.reason === 'too-big' ? MSG_TOO_BIG : MSG_VIDEO);
    }
    if (!sink) return refuse(MSG_NO_SINK);
    if (!canUpload(u)) return refuse(MSG_HEADS_ONLY);
    const caption = m.caption?.trim() || null;
    const up = await store.addUpload({
      telegram_id: u.telegram_id, chat_id: chat, message_id: m.message_id, media_group_id: m.media_group_id ?? null,
      file_id: media.file_id, file_name: media.file_name, mime: media.mime, file_size: media.file_size, caption,
      sent_at: new Date((m.date ?? Math.floor(clock() / 1000)) * 1000).toISOString(),
    });
    if (!up) return; // Telegram повторив те саме оновлення — питання вже поставлено
    // альбом приходить окремими повідомленнями: питаємо один раз; кнопки діють на весь альбом
    if (up.media_group_id && !(await store.claim('upload-ask', `${chat}:${up.media_group_id}`))) {
      if (!caption) return;
      const list = await store.vehicles();
      const hint = parseCaption(caption, list);
      if (hint.vehicles.length) await askVehicle(chat, up, caption, hint, list, true);
      return;
    }
    const list = await store.vehicles();
    await askVehicle(chat, up, caption, caption ? parseCaption(caption, list) : null, list, false);
  }

  /** замінити повідомлення з кнопками (питання → результат); якщо не вийшло — надіслати нове */
  async function replace(q: CB, html: string, buttons?: Button[][]) {
    if (q.message) {
      try { await tg.edit(q.message.chat.id, q.message.message_id, html, buttons); return; } catch { /* надто старе — нижче нове */ }
    }
    await tg.send(q.message?.chat.id ?? q.from.id, html, buttons);
  }

  async function onUploadCallback(q: CB, u: BotUser, kind: string, parts: string[]) {
    if (!canUpload(u)) return answer(q.id, sink ? 'Фото через бота приймає лише координатор' : 'Збереження фото не налаштоване');
    const uid = Number(parts[1]);
    const chat = q.message?.chat.id ?? q.from.id;
    const group = Number.isSafeInteger(uid) && uid > 0 ? await store.uploadGroup(uid) : [];
    // кнопки діють лише у своєму чаті: чужі фото так не зберегти й не скасувати
    if (!group.length || group.some(g => g.chat_id !== chat)) return answer(q.id, 'Ці фото не знайдено');
    const now = clock();
    if (kind === 'ux') {
      const open = group.filter(g => g.status === 'pending').map(g => g.id);
      if (!open.length) return answer(q.id, closedReason(group));
      await store.updateUploads(open, { status: 'cancelled' }, 'pending');
      await answer(q.id, 'Скасовано');
      return replace(q, `Скасовано: ${open.length} фото не збережено.`);
    }
    if (!group.some(g => isOpen(g, now))) return answer(q.id, closedReason(group));
    const vs = await store.vehicles();
    if (kind === 'ua') {
      const list = vs.filter(v => !isFinal(v) || daysSince(v.status_updated_at, now) <= 30)
        .sort((a, b) => Number(isFinal(a)) - Number(isFinal(b)) || a.id.localeCompare(b.id));
      const shown = list.slice(0, 40);
      await answer(q.id);
      return replace(q, [
        `До якого авто? Машини в роботі${list.some(isFinal) ? ' і завершені за останні 30 днів' : ''}:`,
        ...(list.length > shown.length ? [`Показую ${shown.length} з ${list.length}. Немає потрібної — надішліть фото ще раз з номером у підписі, напр. «021».`] : []),
      ].join('\n'), [...shown.map(v => [carBtn(uid, v, null, isFinal(v) ? ' · завершено' : '')]), [{ text: 'Скасувати', data: `ux:${uid}` }]]);
    }
    const v = vs.find(x => x.id === parts[2]);
    if (!v) return answer(q.id, 'Цієї машини вже немає в обліку');
    if (kind === 'uv') {
      await answer(q.id);
      return replace(q, `<b>${esc(v.name)}</b> (${esc(v.id)}). У яку папку?`, [...kindRows(uid, v), otherRow(uid)]);
    }
    // us — зберегти
    const k = CODE_KIND[parts[3] ?? ''];
    if (!k) return answer(q.id, 'Ця кнопка вже не діє');
    const todo = group.filter(g => isOpen(g, now)).map(g => g.id);
    const claimed = new Set(await store.claimUploads(todo, new Date(now - STALE_SAVING_MS).toISOString()));
    if (!claimed.size) return answer(q.id, 'Уже зберігаю…');
    await answer(q.id, 'Зберігаю…');
    let savedTo: SavedPhoto | null = null;
    const errors: string[] = [];
    for (const g of group) {
      if (!claimed.has(g.id)) continue;
      try {
        const bytes = await tg.download(g.file_id);
        const r = await sink!.save({ vehicleId: v.id, vehicleName: v.name, kind: k, fileName: uploadFileName(g, v.id, tz), mime: g.mime, bytes });
        await store.updateUploads([g.id], { status: 'saved', vehicle_id: v.id, kind: k, drive_file_id: r.fileId, error: null });
        savedTo = r;
      } catch (e) {
        errors.push(errText(e));
        await store.updateUploads([g.id], { status: 'pending', error: errText(e) }).catch(() => undefined);
      }
    }
    const after = await store.uploadGroup(uid);
    const total = after.filter(g => g.status !== 'cancelled').length;
    const done = after.filter(g => g.status === 'saved').length;
    const where = savedTo ? ` → «${esc(savedTo.folderName)}»` : '';
    const photosUrl = carUrl(v.id, 'photos');
    const links: Button[][] = [...(savedTo ? [[{ text: 'Відкрити папку на Drive', url: savedTo.folderUrl }]] : []), ...(photosUrl ? [[{ text: 'Фото в картці авто', url: photosUrl }]] : [])];
    if (!errors.length) return replace(q, `Збережено ${done} фото${where}.`, links);
    const retry: Button[] = [{ text: 'Спробувати ще раз', data: `us:${uid}:${v.id}:${KIND_CODE[k]}` }];
    if (done) return replace(q, `Збережено ${done} з ${total} фото${where}. Не вдалося ${errors.length}: ${esc(errors[0])}`, [retry, ...links]);
    return replace(q, `Не вдалося зберегти ${errors.length} фото: ${esc(errors[0])}`, [retry, [{ text: 'Скасувати', data: `ux:${uid}` }]]);
  }

  async function onCallback(q: NonNullable<TgUpdate['callback_query']>) {
    const u = await userOf(q.from.id);
    const chat = q.message?.chat.id ?? q.from.id;
    if (!u) return tg.answerCallback(q.id, 'Вас ще не підключено до бота');
    const parts = (q.data ?? '').split(':');
    if (['us', 'uv', 'ua', 'ux'].includes(parts[0])) return onUploadCallback(q, u, parts[0], parts);
    if (['ad', 'av', 'ax'].includes(parts[0])) return onDraftCallback(q, u, parts[0], parts);
    const [kind, a, ...rest] = parts;
    const b = rest.join(':');
    const vs = await store.vehicles();
    const v = vs.find(x => x.id === a);
    if (kind === 'car') { await tg.answerCallback(q.id); return v ? sendCard(chat, v, u) : tg.send(chat, 'Цієї машини вже немає в обліку.'); }
    if (u.role !== 'head') return tg.answerCallback(q.id, 'Це може лише координатор');
    if (kind === 'ok' && v) {
      await store.confirmNoChange(v.id);
      await tg.answerCallback(q.id, 'Записав: без змін');
      return tg.send(chat, `${esc(v.name)}: статус «${esc(v.status)}» підтверджено. Нагадаю, якщо знову довго не буде змін.`);
    }
    if (kind === 'st' && v) {
      const st = await store.statuses();
      await tg.answerCallback(q.id);
      return tg.send(chat, `${esc(v.name)} зараз: <b>${esc(v.status)}</b>. Новий статус:`,
        st.map((s, i) => [{ text: s === v.status ? `${s} (зараз)` : s, data: `ss:${v.id}:${i}` }]));
    }
    if (kind === 'ss' && v) {
      const st = await store.statuses();
      const s = st[Number(b)];
      if (!s) return tg.answerCallback(q.id, 'Статус не знайдено');
      if (s !== v.status) await store.setStatus(v.id, s); else await store.confirmNoChange(v.id);
      await tg.answerCallback(q.id, 'Збережено');
      await tg.send(chat, `${esc(v.name)}: статус <b>${esc(s)}</b>.`);
      // ремонт завершено → база створила чернетку звіту; повідомляємо одразу, не чекаючи щогодинного запуску
      if (FINAL_STATUSES.includes(s) && !FINAL_STATUSES.includes(v.status)) await notifyReports();
      return;
    }
    if (kind === 'add') {
      const id = Number(a);
      if (!id) return tg.answerCallback(q.id, 'Неправильний запит');
      const name = b.trim() || `ID ${id}`;
      await store.upsertUser({ telegram_id: id, name, role: 'member', notify: false });
      await tg.answerCallback(q.id, 'Підключено');
      await tg.send(id, 'Вас підключено до бота обліку авто СТО «База». Напишіть /help, щоб побачити, що я вмію.').catch(() => undefined);
      return tg.send(chat, `Підключено: ${esc(name)}.`);
    }
    if (kind === 'ign') return tg.answerCallback(q.id, 'Запит проігноровано');
    return tg.answerCallback(q.id, 'Ця кнопка вже не діє');
  }

  /** Обробити оновлення Telegram. true — оновлення стосувалось бота «Бази». */
  async function handleUpdate(up: TgUpdate): Promise<boolean> {
    if (up.callback_query) { await onCallback(up.callback_query); return true; }
    const m = up.message;
    if (!m?.from) return false;
    if (m.chat.type && m.chat.type !== 'private') return false; // лише особисті чати: у групах не відповідаємо
    const u = await userOf(m.from.id);
    if (!u) { await onUnknown(m, m.from); return true; }
    const media = mediaOf(m);
    if (media) { await onMedia(m, u, media); return true; }
    if (typeof m.text === 'string') { await onText(m, u); return true; }
    return false;
  }

  return { handleUpdate, runScheduled, buildDigest, notifyReports };
}
