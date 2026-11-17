import { describe, it, expect, beforeEach } from 'vitest';
import { createBaseBot, findVehicles, localParts, fitBytes, FINAL_STATUSES as BOT_FINAL, STALE_DAYS, type Button, type BotVehicle, type TgUpdate } from '../supabase/functions/_shared/base-bot/core';
import { createMemoryStore, type MemoryData } from '../supabase/functions/_shared/base-bot/memory-store';
import { demoData } from '../src/lib/base/demoData';
import { FINAL_STATUSES, STALE_AFTER_DAYS } from '../src/lib/base/format';

const OLEG = 111111111, IVAN = 222222222, STRANGER = 333333333;
const AT_0905 = Date.parse('2026-11-18T07:05:00Z'); // 09:05 за Києвом (UTC+2)
let now = AT_0905;
type Sent = { chat: number; html: string; buttons?: Button[][] };
let sent: Sent[] = [];
let answers: { id: string; text?: string }[] = [];
const tg = {
  send: async (chat: number, html: string, buttons?: Button[][]) => { sent.push({ chat, html, buttons }); },
  edit: async (chat: number, _id: number, html: string, buttons?: Button[][]) => { sent.push({ chat, html, buttons }); },
  answerCallback: async (id: string, text?: string) => { answers.push({ id, text }); },
  download: async () => new Uint8Array([1]),
};

function data(): MemoryData {
  const d = demoData(new Date(now));
  const vehicles: BotVehicle[] = d.vehicles.map(v => ({
    id: v.id, name: v.name, status: v.status, blocker: v.blocker, next_step: v.next_step, responsible: v.responsible,
    status_updated_at: v.status_updated_at, military_unit: v.military_unit,
    open_jobs: d.jobs.filter(j => j.vehicle_id === v.id && j.status !== 'Завершено').length,
    parts_waiting: d.parts.filter(p => p.vehicle_id === v.id && p.status === 'Замовлено').length,
  }));
  vehicles.push({ id: 'АВТО-021', name: 'Toyota Hilux (білий)', status: 'В ремонті', blocker: null, next_step: 'Фарбування в Житомирі', responsible: 'Майстер Тест',
    status_updated_at: new Date(now - 2 * 86400000).toISOString(), military_unit: null, open_jobs: 1, parts_waiting: 1 });
  const money: MemoryData['money'] = {};
  for (const f of d.finance) if (f.vehicle_id) {
    const m = (money[f.vehicle_id] ??= { total: 0, pending: 0 });
    m.total += f.amount; if (f.pay_status === 'Очікує оплати') m.pending += f.amount;
  }
  const md: MemoryData = {
    vehicles,
    parts: [
      ...d.parts.filter(p => p.status === 'Замовлено').map(p => ({ vehicle_id: p.vehicle_id, name: p.name, qty: p.qty, ordered_on: p.ordered_on })),
      { vehicle_id: 'АВТО-021', name: 'Комплект ГРМ', qty: 1, ordered_on: new Date(now - 10 * 86400000).toISOString().slice(0, 10) },
    ],
    payments: d.finance.filter(f => f.pay_status === 'Очікує оплати').map(f => ({ vehicle_id: f.vehicle_id, amount: f.amount, spent_on: f.spent_on, purpose: f.purpose })),
    reports: d.reports.filter(r => r.status === 'Чернетка').map(r => ({ vehicle_id: r.vehicle_id, name: d.vehicles.find(v => v.id === r.vehicle_id)!.name, created_at: '2026-11-15T10:00:00Z' })),
    money, statuses: d.statuses,
    users: [{ telegram_id: IVAN, name: 'Іван', role: 'member', notify: false }],
  };
  md.onFinal = id => { if (!md.reports.some(r => r.vehicle_id === id)) md.reports.push({ vehicle_id: id, name: md.vehicles.find(v => v.id === id)!.name, created_at: new Date(now).toISOString() }); };
  return md;
}
let md: MemoryData;
let mem: ReturnType<typeof createMemoryStore>;
let bot: ReturnType<typeof createBaseBot>;
beforeEach(() => {
  now = AT_0905; sent = []; answers = [];
  md = data(); mem = createMemoryStore(md, () => now);
  bot = createBaseBot(mem.store, tg, { appUrl: 'https://shtab.example', headIds: [OLEG] }, () => now);
});
const msg = (from: number, text: string, extra: Partial<NonNullable<TgUpdate['message']>> = {}): TgUpdate =>
  ({ message: { message_id: 1, chat: { id: from, type: 'private' }, from: { id: from, first_name: from === STRANGER ? 'Петро' : 'X' }, text, ...extra } });
const tap = (from: number, data: string): TgUpdate => ({ callback_query: { id: `cb${Math.random()}`, from: { id: from }, data, message: { message_id: 2, chat: { id: from } } } });
const last = () => sent[sent.length - 1];
const allButtons = (s: Sent) => (s.buttons ?? []).flat();

describe('бот: узгодженість із модулем', () => {
  it('фінальні статуси і поріг «давно без оновлення» ті самі, що в інтерфейсі', () => {
    expect(BOT_FINAL).toEqual(FINAL_STATUSES);
    expect(STALE_DAYS).toBe(STALE_AFTER_DAYS);
  });
});

describe('бот: доступ', () => {
  it('незнайомий: бачить свій ID; координатор отримує запит з кнопками; повторно не дублюється', async () => {
    await bot.handleUpdate(msg(STRANGER, '/start'));
    expect(sent[0].chat).toBe(STRANGER);
    expect(sent[0].html).toContain(`<code>${STRANGER}</code>`);
    const req = sent.find(s => s.chat === OLEG)!;
    expect(req.html).toContain('Запит на доступ');
    expect(allButtons(req).map(b => 'data' in b ? b.data : '')).toEqual([`add:${STRANGER}:Петро`, `ign:${STRANGER}`]);
    sent = [];
    await bot.handleUpdate(msg(STRANGER, 'що з хайлюксом'));
    expect(sent.filter(s => s.chat === OLEG)).toHaveLength(0);
    expect(sent[0].html).not.toContain('Hilux');
  });
  it('координатор підключає одним натисканням; людина отримує привітання й може питати', async () => {
    await bot.handleUpdate(tap(OLEG, `add:${STRANGER}:Петро`));
    expect(md.users.find(u => u.telegram_id === STRANGER)).toMatchObject({ role: 'member', name: 'Петро' });
    expect(sent.some(s => s.chat === STRANGER && s.html.includes('Вас підключено'))).toBe(true);
    sent = [];
    await bot.handleUpdate(msg(STRANGER, '021'));
    expect(last().html).toContain('Toyota Hilux (білий)');
  });
  it('член команди не може натискати кнопки керівника', async () => {
    await bot.handleUpdate(tap(IVAN, 'ss:АВТО-002:3'));
    expect(answers[0].text).toBe('Це може лише координатор');
    expect(mem.calls.setStatus).toEqual([]);
  });
  it('у групових чатах бот мовчить', async () => {
    expect(await bot.handleUpdate({ message: { message_id: 1, chat: { id: -100, type: 'group' }, from: { id: IVAN }, text: '021' } })).toBe(false);
    expect(sent).toEqual([]);
  });
  it('ім’я в кнопці «Підключити» обрізається до 64 байтів без зламаних літер', () => {
    const d = fitBytes(`add:${STRANGER}:Олександра-Вікторія Костянтинівна Шевченко-Ковальчук`, 64);
    expect(new TextEncoder().encode(d).length).toBeLessThanOrEqual(64);
    expect(d).not.toContain('�');
  });
});

describe('бот: що з машиною', () => {
  it('«що з хайлюксом?» знаходить Toyota Hilux; член команди бачить без грошей і без кнопок статусу', async () => {
    await bot.handleUpdate(msg(IVAN, 'що з хайлюксом?'));
    const c = last();
    expect(c.html).toContain('<b>Toyota Hilux (білий)</b> · АВТО-021');
    expect(c.html).toContain('Що далі: Фарбування в Житомирі');
    expect(c.html).not.toContain('Витрачено');
    expect(allButtons(c).some(b => 'data' in b)).toBe(false);
    expect(allButtons(c)).toContainEqual({ text: 'Відкрити в «Штабі»', url: 'https://shtab.example/base/car/?id=%D0%90%D0%92%D0%A2%D0%9E-021' });
  });
  it('керівник бачить гроші й кнопки «Без змін» / «Змінити статус»', async () => {
    await bot.handleUpdate(msg(OLEG, '1'));
    const c = last();
    expect(c.html).toContain('Тестовий Пікап А');
    expect(c.html).toMatch(/Витрачено: 7 100,00 грн · очікує оплати: 6 200,00 грн/);
    expect(allButtons(c).map(b => b.text)).toEqual(['Без змін', 'Змінити статус', 'Відкрити в «Штабі»']);
  });
  it('кілька збігів — вибір кнопками; ніщо не знайдено — підказка', async () => {
    await bot.handleUpdate(msg(IVAN, 'тестовий джип'));
    expect(last().html).toContain('Знайшов 2 машини');
    expect(allButtons(last()).map(b => ('data' in b ? b.data : ''))).toEqual(['car:АВТО-003', 'car:АВТО-005']);
    await bot.handleUpdate(tap(IVAN, 'car:АВТО-005'));
    expect(last().html).toContain('Тестовий Джип Д');
    await bot.handleUpdate(msg(IVAN, 'бульдозер'));
    expect(last().html).toContain('Не знайшов машину «бульдозер»');
  });
  it('у картці немає VIN, номерів і контактів', async () => {
    await bot.handleUpdate(msg(OLEG, 'що з пікапом а'));
    expect(last().html).not.toMatch(/TEST-VIN|АА0001ТТ/);
  });
  it('пошук: номер, відмінки, латиниця, кирилиця', () => {
    const vs = md.vehicles;
    expect(findVehicles('АВТО-021', vs).map(v => v.id)).toEqual(['АВТО-021']);
    expect(findVehicles('авто 21', vs).map(v => v.id)).toEqual(['АВТО-021']);
    expect(findVehicles('Hilux', vs).map(v => v.id)).toEqual(['АВТО-021']);
    expect(findVehicles('тойота біла', vs).map(v => v.id)).toEqual(['АВТО-021']);
    expect(findVehicles('бусом е', vs).map(v => v.id)).toContain('АВТО-006');
  });
  it('HTML у назвах екранується', async () => {
    md.vehicles[0].name = 'Пікап <b>жирний</b> & Ко';
    await bot.handleUpdate(msg(IVAN, '001'));
    expect(last().html).toContain('Пікап &lt;b&gt;жирний&lt;/b&gt; &amp; Ко');
  });
});

describe('бот: команди', () => {
  it('/cars, /problems, /summary; команда з @ім’ям бота', async () => {
    await bot.handleUpdate(msg(IVAN, '/cars@BazaTykhoBot'));
    expect(last().html).toMatch(/В роботі: 5/);
    expect(last().html).toContain('Готові до передачі: Тестовий Джип В');
    await bot.handleUpdate(msg(IVAN, '/problems'));
    expect(last().html).toContain('Чекаємо паливний насос');
    expect(last().html).toContain('Тестовий Бус Б: Діагностика · 12 днів');
    await bot.handleUpdate(msg(IVAN, '/summary'));
    expect(last().html).not.toContain('Очікує оплати');
    await bot.handleUpdate(msg(OLEG, '/summary'));
    expect(last().html).toContain('Очікує оплати: 21 200,00 грн');
  });
  it('/reports лише керівнику; /team, /add, /remove', async () => {
    await bot.handleUpdate(msg(IVAN, '/reports'));
    expect(last().html).toContain('лише координатору');
    await bot.handleUpdate(msg(OLEG, '/reports'));
    expect(last().html).toContain('Тестовий Джип В (АВТО-003)');
    await bot.handleUpdate(msg(OLEG, '/add 444444444 керівник Андрій'));
    expect(md.users.find(u => u.telegram_id === 444444444)?.role).toBe('head');
    await bot.handleUpdate(msg(OLEG, '/remove 444444444'));
    expect(md.users.find(u => u.telegram_id === 444444444)).toBeUndefined();
    await bot.handleUpdate(msg(OLEG, `/remove ${OLEG}`));
    expect(last().html).toContain('задано в налаштуваннях бота');
    await bot.handleUpdate(msg(IVAN, '/add 555555555 команда Хтось'));
    expect(last().html).toContain('лише координатор');
  });
  it('фото без налаштованого сховища — пояснення, куди класти (решта фото — у bot.photos.test.ts)', async () => {
    await bot.handleUpdate(msg(OLEG, '', { text: undefined, photo: [{ file_id: 'f1', width: 10, height: 10 }] }));
    expect(last().html).toContain('Фото через бота ще не налаштовані');
  });
});

describe('бот: статус кнопками', () => {
  it('«Змінити статус» → список → вибір; «Готовий» одразу шле посилання на чернетку звіту', async () => {
    await bot.handleUpdate(tap(OLEG, 'st:АВТО-002'));
    const opts = allButtons(last()).map(b => ('data' in b ? b.data : ''));
    expect(opts).toEqual(md.statuses.map((_, i) => `ss:АВТО-002:${i}`));
    const ready = md.statuses.indexOf('Готовий');
    await bot.handleUpdate(tap(OLEG, `ss:АВТО-002:${ready}`));
    expect(mem.calls.setStatus).toEqual([['АВТО-002', 'Готовий']]);
    expect(sent.some(s => s.html.includes('Тестовий Бус Б: статус <b>Готовий</b>'))).toBe(true);
    const notice = sent.find(s => s.html.includes('Ремонт завершено: Тестовий Бус Б'))!;
    expect(allButtons(notice)[0]).toEqual({ text: 'Відкрити звіт', url: 'https://shtab.example/base/car/?id=%D0%90%D0%92%D0%A2%D0%9E-002&tab=report' });
  });
  it('«Без змін» скидає лічильник: машина зникає з «давно не оновлювались»', async () => {
    await bot.handleUpdate(tap(OLEG, 'ok:АВТО-002'));
    expect(mem.calls.confirm).toEqual(['АВТО-002']);
    const d = await bot.buildDigest('head');
    expect(d!.html).not.toContain('Тестовий Бус Б (АВТО-002)');
  });
});

describe('бот: нагадування', () => {
  it('о 7:00 зведення ще немає, о 9:05 — одне на день; наступного дня — знову', async () => {
    now = Date.parse('2026-11-18T05:00:00Z');
    expect((await bot.runScheduled()).digest).toBe(false);
    now = AT_0905;
    expect((await bot.runScheduled()).digest).toBe(true);
    const n = sent.filter(s => s.html.includes('зведення на 18.11')).length;
    expect(n).toBe(1);
    expect((await bot.runScheduled()).digest).toBe(false);
    now = AT_0905 + 86400000;
    expect((await bot.runScheduled()).digest).toBe(true);
  });
  it('зведення: блокери, застарілі з кнопками, запчастини понад 7 днів, звіти, неоплачене понад 14 днів', async () => {
    await bot.runScheduled();
    const d = sent.find(s => s.html.includes('зведення на'))!;
    expect(d.chat).toBe(OLEG);
    expect(d.html).toContain('<b>Блокери</b>');
    expect(d.html).toContain('Тестовий Бус Б (АВТО-002): Діагностика · 12 днів');
    expect(d.html).toContain('Комплект ГРМ × 1 для Toyota Hilux (білий)');
    expect(d.html).not.toContain('Паливний насос × 1'); // замовлено 5 днів тому
    expect(d.html).toContain('Тестовий Джип В (АВТО-003): ремонт завершено');
    expect(d.html).toContain('Очікує оплати понад 14 днів: 15 000,00 грн');
    expect(d.html).not.toContain('6 200,00'); // неоплачене 5 днів — ще рано
    expect(allButtons(d).map(b => ('data' in b ? b.data : b.url))).toEqual(['ok:АВТО-002', 'st:АВТО-002', 'https://shtab.example/base/']);
    expect(d.html.length).toBeLessThan(4096);
  });
  it('чернетки звітів: повідомлення по кожній один раз', async () => {
    const r1 = await bot.runScheduled();
    expect(r1.reportNotices).toBe(2);
    expect(sent.filter(s => s.html.startsWith('<b>Ремонт завершено:')).map(s => s.chat)).toEqual([OLEG, OLEG]);
    sent = [];
    expect((await bot.runScheduled()).reportNotices).toBe(0);
  });
  it('нагадування лише керівникам з увімкненими нагадуваннями, не команді', async () => {
    await bot.runScheduled();
    expect(sent.every(s => s.chat === OLEG)).toBe(true);
  });
  it('коли нічого нагадувати — зведення не надсилається', async () => {
    md.vehicles = md.vehicles.map(v => ({ ...v, blocker: null, status_updated_at: new Date(now).toISOString() }));
    md.parts = []; md.payments = []; md.reports = [];
    expect((await bot.runScheduled()).digest).toBe(false);
    expect(sent).toEqual([]);
  });
  it('київський час із переходом на зимовий: 07:05 UTC у листопаді — це 09:05', () => {
    expect(localParts(AT_0905)).toEqual({ date: '2026-11-18', hour: 9 });
    expect(localParts(Date.parse('2026-07-01T06:05:00Z')).hour).toBe(9); // влітку UTC+3
  });
});
