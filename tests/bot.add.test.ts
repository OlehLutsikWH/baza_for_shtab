// Роботи й запчастини через бота (рішення Олега 18.11.2026): «021 робота …», «021 запчастина … 2 шт 4900 грн»,
// бот показує, що зрозумів, і керівник підтверджує кнопкою.
import { describe, it, expect, beforeEach } from 'vitest';
import { createBaseBot, parseAddCommand, type BotVehicle, type Button, type TgUpdate } from '../supabase/functions/_shared/base-bot/core';
import { createMemoryStore, type MemoryData } from '../supabase/functions/_shared/base-bot/memory-store';

const OLEG = 111111111, IVAN = 222222222, ANDRIY = 444444444;
const T0 = Date.parse('2026-11-18T07:05:00Z');
const veh = (id: string, name: string, status = 'В ремонті'): BotVehicle =>
  ({ id, name, status, blocker: null, next_step: null, responsible: null, status_updated_at: new Date(T0 - 86_400_000).toISOString(), military_unit: null, open_jobs: 0, parts_waiting: 0 });
const VEHICLES = () => [veh('АВТО-021', 'Toyota Hilux (білий)'), veh('АВТО-025', 'Mitsubishi L200 Warrior (третя)'), veh('АВТО-030', 'Toyota Land Cruiser 200')];

type Sent = { chat: number; html: string; buttons?: Button[][] };
let sent: Sent[], edits: (Sent & { messageId: number })[], answers: { text?: string }[], now: number;
let mem: ReturnType<typeof createMemoryStore>, bot: ReturnType<typeof createBaseBot>;
const tg = {
  send: async (chat: number, html: string, buttons?: Button[][]) => { sent.push({ chat, html, buttons }); },
  edit: async (chat: number, messageId: number, html: string, buttons?: Button[][]) => { edits.push({ chat, messageId, html, buttons }); },
  answerCallback: async (_id: string, text?: string) => { answers.push({ text }); },
  download: async () => new Uint8Array(),
};
beforeEach(() => {
  sent = []; edits = []; answers = []; now = T0;
  const md: MemoryData = { vehicles: VEHICLES(), parts: [], payments: [], reports: [], money: {}, statuses: ['В ремонті', 'Готовий'],
    users: [{ telegram_id: IVAN, name: 'Іван', role: 'member', notify: false }, { telegram_id: ANDRIY, name: 'Андрій', role: 'head', notify: false }] };
  mem = createMemoryStore(md, () => now);
  bot = createBaseBot(mem.store, tg, { appUrl: 'https://shtab.example', headIds: [OLEG] }, () => now);
});
let seq = 500;
const text = (from: number, t: string): TgUpdate => ({ message: { message_id: ++seq, chat: { id: from, type: 'private' }, from: { id: from, first_name: 'Т' }, date: Math.floor(now / 1000), text: t } });
const tap = (from: number, data: string): TgUpdate => ({ callback_query: { id: `cb${++seq}`, from: { id: from }, data, message: { message_id: 900, chat: { id: from } } } });
const datas = (s: { buttons?: Button[][] }) => (s.buttons ?? []).flat().map(b => ('data' in b ? b.data : b.url));
const last = () => sent[sent.length - 1];
const lastEdit = () => edits[edits.length - 1];
const nb = (s: string) => s.replace(/ /g, ' ');

describe('розбір команди', () => {
  const list = VEHICLES();
  const ids = (t: string) => parseAddCommand(t, list)?.vehicles.map(v => v.id);
  it('робота: номер перед словом, після слова, /job', () => {
    expect(parseAddCommand('021 робота Заміна ременя ГРМ', list)).toMatchObject({ kind: 'job', text: 'Заміна ременя ГРМ', qty: 1, cost: null, problem: null, atStart: false });
    expect(ids('021 робота Заміна ременя ГРМ')).toEqual(['АВТО-021']);
    expect(parseAddCommand('Робота 021: заміна ГРМ', list)).toMatchObject({ kind: 'job', text: 'заміна ГРМ', atStart: true });
    expect(ids('/job 025 Діагностика ходової')).toEqual(['АВТО-025']);
    expect(ids('тойота хайлюкс робота Заміна мастила')).toEqual(['АВТО-021']);
    expect(ids('тойота робота Заміна мастила')).toEqual(['АВТО-021', 'АВТО-030']);
  });
  it('запчастина: кількість «2 шт» / «×2», ціна «4 900 грн» — за всю позицію, решта — назва', () => {
    expect(parseAddCommand('/part@BazaBot 021 Ремінь ГРМ 2 шт 4 900 грн', list)).toMatchObject({ kind: 'part', text: 'Ремінь ГРМ', qty: 2, cost: 4900 });
    expect(parseAddCommand('хайлюкс запчастина Фільтр паливний ×2', list)).toMatchObject({ text: 'Фільтр паливний', qty: 2, cost: null });
    expect(parseAddCommand('021 запчастина Олива 5W30 4 л 1850,50 грн', list)).toMatchObject({ text: 'Олива 5W30 4 л', qty: 1, cost: 1850.5 });
    expect(parseAddCommand('021 деталь Колодки передні, 4900грн', list)).toMatchObject({ text: 'Колодки передні', cost: 4900 });
  });
  it('не команда: питання, звичайний текст; помилки: без опису, кількість 0', () => {
    expect(parseAddCommand('яка робота лишилась по хайлюксу?', list)).toBeNull();
    expect(parseAddCommand('привіт', list)).toBeNull();
    expect(parseAddCommand('Дякую за роботу', list)).toMatchObject({ vehicles: [], text: '' });
    expect(parseAddCommand('021 робота', list)!.problem).toContain('Опишіть роботу');
    expect(parseAddCommand('021 запчастина Ремінь 0 шт', list)!.problem).toBe('Кількість має бути від 1 до 10 000.');
  });
});

describe('додавання через бота', () => {
  it('робота: бот перепитує, «Додати» — робота заплановано, результат замість питання з посиланням на картку', async () => {
    await bot.handleUpdate(text(OLEG, '021 робота Заміна ременя ГРМ'));
    expect(last().html).toBe('Додати роботу?\n<b>Toyota Hilux (білий)</b> (АВТО-021)\nРобота: «Заміна ременя ГРМ»');
    expect(datas(last())).toEqual(['ad:1', 'ax:1']);
    expect(mem.jobs).toEqual([]); // до підтвердження нічого не додано
    await bot.handleUpdate(tap(OLEG, 'ad:1'));
    expect(mem.jobs).toEqual([{ id: 2, vehicle_id: 'АВТО-021', description: 'Заміна ременя ГРМ', status: 'Заплановано' }]);
    expect(lastEdit().html).toBe('Додано до <b>Toyota Hilux (білий)</b> (АВТО-021):\nРобота: «Заміна ременя ГРМ»\nСтатус: заплановано.');
    expect(datas(lastEdit())).toEqual(['https://shtab.example/base/car/?id=%D0%90%D0%92%D0%A2%D0%9E-021']);
    expect(mem.drafts[0]).toMatchObject({ status: 'done', record_id: 2 });
    expect(answers.map(a => a.text)).toEqual(['Додаю…']);
  });
  it('запчастина з ціною: вартість позиції в питанні; додається «замовлено» з датою за Києвом', async () => {
    await bot.handleUpdate(text(OLEG, '021 запчастина Ремінь ГРМ 2 шт 4 900 грн'));
    expect(nb(last().html)).toBe('Додати запчастину?\n<b>Toyota Hilux (білий)</b> (АВТО-021)\nЗапчастина: «Ремінь ГРМ» · 2 шт · вартість позиції 4 900,00 грн');
    await bot.handleUpdate(tap(OLEG, 'ad:1'));
    expect(mem.parts).toEqual([{ id: 2, vehicle_id: 'АВТО-021', name: 'Ремінь ГРМ', qty: 2, cost_total: 4900, status: 'Замовлено', ordered_on: '2026-11-18' }]);
    expect(datas(lastEdit())[0]).toBe('https://shtab.example/base/car/?id=%D0%90%D0%92%D0%A2%D0%9E-021&tab=parts');
  });
  it('кілька машин: спершу вибір машини, «Додати» до вибору — підказка', async () => {
    await bot.handleUpdate(text(OLEG, 'тойота робота Заміна мастила'));
    expect(last().html).toBe('Додати роботу — до якої машини?\nРобота: «Заміна мастила»');
    expect(datas(last())).toEqual(['av:1:АВТО-021', 'av:1:АВТО-030', 'ax:1']);
    await bot.handleUpdate(tap(OLEG, 'ad:1'));
    expect(answers.at(-1)!.text).toBe('Спершу оберіть машину');
    await bot.handleUpdate(tap(OLEG, 'av:1:АВТО-030'));
    expect(lastEdit().html).toBe('Додати роботу?\n<b>Toyota Land Cruiser 200</b> (АВТО-030)\nРобота: «Заміна мастила»');
    await bot.handleUpdate(tap(OLEG, 'ad:1'));
    expect(mem.jobs[0]).toMatchObject({ vehicle_id: 'АВТО-030', description: 'Заміна мастила' });
  });
  it('«Скасувати» — нічого не додано; пізніше «Додати» — «скасовано раніше»', async () => {
    await bot.handleUpdate(text(OLEG, '021 робота Заміна ГРМ'));
    await bot.handleUpdate(tap(OLEG, 'ax:1'));
    expect(lastEdit()).toMatchObject({ html: 'Скасовано — нічого не додано.', buttons: undefined });
    await bot.handleUpdate(tap(OLEG, 'ad:1'));
    expect(answers.at(-1)!.text).toBe('Скасовано раніше');
    expect(mem.jobs).toEqual([]);
  });
  it('два натискання «Додати» одночасно — одна робота', async () => {
    await bot.handleUpdate(text(OLEG, '021 робота Заміна ГРМ'));
    await Promise.all([bot.handleUpdate(tap(OLEG, 'ad:1')), bot.handleUpdate(tap(OLEG, 'ad:1'))]);
    expect(mem.jobs).toHaveLength(1);
    expect(answers.map(a => a.text).sort()).toEqual(['Додаю…', 'Уже додаю…']);
  });
  it('помилка бази — пояснення й «Спробувати ще раз»; повтор додає', async () => {
    await bot.handleUpdate(text(OLEG, '021 запчастина Ремінь ГРМ'));
    mem.fail.next = 'Запчастина: немає з’єднання з базою';
    await bot.handleUpdate(tap(OLEG, 'ad:1'));
    expect(lastEdit().html).toContain('Не вдалося додати: Запчастина: немає з’єднання з базою');
    expect(datas(lastEdit())).toEqual(['ad:1', 'ax:1']);
    expect(mem.drafts[0].status).toBe('pending');
    await bot.handleUpdate(tap(OLEG, 'ad:1'));
    expect(mem.parts).toHaveLength(1);
    expect(lastEdit().html).toContain('Додано до <b>Toyota Hilux (білий)</b>');
  });
  it('член команди не додає; чужу чернетку не підтвердить навіть інший керівник', async () => {
    await bot.handleUpdate(text(IVAN, '021 робота Заміна ГРМ'));
    expect(last().html).toBe('Додавати роботи й запчастини може лише координатор.');
    await bot.handleUpdate(text(OLEG, '021 робота Заміна ГРМ'));
    await bot.handleUpdate(tap(IVAN, 'ad:1'));
    expect(answers.at(-1)!.text).toBe('Додавати роботи й запчастини може лише координатор');
    await bot.handleUpdate(tap(ANDRIY, 'ad:1'));
    expect(answers.at(-1)!.text).toBe('Чернетку не знайдено');
    await bot.handleUpdate(tap(OLEG, 'ad:abc'));
    expect(answers.at(-1)!.text).toBe('Чернетку не знайдено');
    expect(mem.jobs).toEqual([]);
    await bot.handleUpdate(text(ANDRIY, '025 робота Діагностика'));
    await bot.handleUpdate(tap(ANDRIY, 'ad:2'));
    expect(mem.jobs[0]).toMatchObject({ vehicle_id: 'АВТО-025' }); // Андрій — керівник, свою чернетку підтверджує
  });
  it('повідомлення старше доби не додає', async () => {
    await bot.handleUpdate(text(OLEG, '021 робота Заміна ГРМ'));
    now = T0 + 25 * 3600_000;
    await bot.handleUpdate(tap(OLEG, 'ad:1'));
    expect(lastEdit().html).toBe('Це повідомлення старше доби — нічого не додано. Надішліть ще раз, якщо треба.');
    expect(mem.drafts[0].status).toBe('cancelled');
    expect(mem.jobs).toEqual([]);
  });
  it('машину не знайдено — підказка формату; питання без «?» — звичайний пошук машини', async () => {
    await bot.handleUpdate(text(OLEG, 'робота заміна ГРМ'));
    expect(last().html).toBe('Не знайшов машину «заміна». Почніть з номера: «021 робота Заміна ременя ГРМ».');
    await bot.handleUpdate(text(OLEG, '/part'));
    expect(last().html).toBe('Вкажіть назву запчастини, наприклад: «021 запчастина Ремінь ГРМ 2 шт».');
    await bot.handleUpdate(text(OLEG, '/job 021'));
    expect(last().html).toBe('Опишіть роботу, наприклад: «021 робота Заміна ременя ГРМ».');
    await bot.handleUpdate(text(OLEG, 'яка робота лишилась по хайлюксу'));
    expect(last().html).toContain('Toyota Hilux');
    expect(mem.drafts).toHaveLength(0);
  });
  it('/help: керівнику — як додавати; члену команди — ні', async () => {
    await bot.handleUpdate(text(OLEG, '/help'));
    expect(last().html).toContain('«021 робота Заміна ременя ГРМ» — додати роботу');
    await bot.handleUpdate(text(IVAN, '/help'));
    expect(last().html).not.toContain('додати роботу');
  });
});
