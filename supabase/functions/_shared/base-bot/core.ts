// Ядро Telegram-бота «Бази». Без залежностей (Deno і Node): дані — через BotStore, Telegram — через BotTelegram.
//
// Що вміє:
//  • раз на день (за замовчуванням о 9:00 за Києвом) — зведення керівникам з увімкненими нагадуваннями:
//    блокери, «давно не оновлювались» (з кнопками «Без змін» і «Змінити статус»), запчастини, що
//    чекають понад 7 днів, звіти для донорів, що чекають, неоплачене понад 14 днів;
//  • щойно ремонт завершено (з'явилась чернетка звіту) — повідомлення з посиланням на звіт;
//  • будь-кому з команди — «що з хайлюксом?», «021», /cars, /problems, /summary;
//  • керівникам — зміна статусу кнопками, /reports, /team, /add, /remove; нові люди просяться через /start,
//    керівник підключає одним натисканням.
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
}
export type Button = { text: string; data: string } | { text: string; url: string };
export interface BotTelegram {
  send(chatId: number, html: string, buttons?: Button[][]): Promise<void>;
  answerCallback(callbackId: string, text?: string): Promise<void>;
}
export interface BotConfig {
  /** адреса «Штабу» для посилань, напр. https://shtab.tykho.org; порожньо — без посилань */
  appUrl: string;
  /** Telegram ID керівників, які завжди мають доступ і нагадування (напр. Олег) */
  headIds: number[];
  timeZone?: string; digestHour?: number; partsDays?: number; paymentsDays?: number;
}

// мінімальні типи оновлень Telegram
export interface TgUser { id: number; first_name?: string; last_name?: string; username?: string }
export interface TgMessage { message_id: number; chat: { id: number; type?: string }; from?: TgUser; text?: string; photo?: unknown; document?: unknown }
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
  if (nums.length === 1 && toks.every(t => numberish(t[0]))) {
    const id = `АВТО-${/(\d{1,4})$/.exec(nums[0])![1].padStart(3, '0')}`;
    return list.filter(v => v.id === id);
  }
  const scored = list.map(v => {
    const name = [...words(v.name), ...words(v.id)];
    const score = toks.filter(alts => alts.some(t => name.some(n => tokenMatch(t, n)))).length;
    return { v, score };
  }).filter(x => x.score > 0);
  const best = Math.max(0, ...scored.map(x => x.score));
  return scored.filter(x => x.score === best).map(x => x.v);
}

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
  '— /reports — звіти для донорів, що чекають;',
  '— /team — хто підключений; /add ID роль ім\'я; /remove ID.',
  'Щодня о 9:00 надсилаю зведення: блокери, що давно не оновлювалось, запчастини, звіти, неоплачене.',
];

// ---------- бот ----------
export function createBaseBot(store: BotStore, tg: BotTelegram, cfg: BotConfig, clock: () => number = () => Date.now()) {
  const tz = cfg.timeZone ?? 'Europe/Kyiv';
  const digestHour = cfg.digestHour ?? 9, partsDays = cfg.partsDays ?? 7, paymentsDays = cfg.paymentsDays ?? 14;
  const link = (path: string) => (cfg.appUrl ? `${cfg.appUrl.replace(/\/$/, '')}${path}` : null);
  const carUrl = (id: string, tab?: string) => link(`/base/car/?id=${encodeURIComponent(id)}${tab ? `&tab=${tab}` : ''}`);

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
      return tg.send(chat, [...HELP_MEMBER, ...(u.role === 'head' ? ['', ...HELP_HEAD] : [])].join('\n'));
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

  async function onCallback(q: NonNullable<TgUpdate['callback_query']>) {
    const u = await userOf(q.from.id);
    const chat = q.message?.chat.id ?? q.from.id;
    if (!u) return tg.answerCallback(q.id, 'Вас ще не підключено до бота');
    const [kind, a, ...rest] = (q.data ?? '').split(':');
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
    if (m.photo || m.document) {
      await tg.send(m.chat.id, 'Фото й файли я поки не приймаю — це наступний крок. Зараз їх можна покласти в папку авто на Google Drive.');
      return true;
    }
    if (typeof m.text === 'string') { await onText(m, u); return true; }
    return false;
  }

  return { handleUpdate, runScheduled, buildDigest, notifyReports };
}
