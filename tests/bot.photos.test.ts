// Фото через бота: питання «До якого авто?», підпис «021 до», альбоми, скасування, подвійне натискання,
// помилка й повтор, відмова для документів і відео, права.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  createBaseBot, parseCaption, uploadFileName, mediaOf, KIND_FOLDER,
  type BotVehicle, type Button, type PhotoSink, type TgDocument, type TgUpdate, type BotConfig,
} from '../supabase/functions/_shared/base-bot/core';
import { createMemoryStore, type MemoryData } from '../supabase/functions/_shared/base-bot/memory-store';

const OLEG = 111111111, IVAN = 222222222, STRANGER = 333333333;
const NOW = Date.parse('2026-11-18T07:05:00Z'); // 09:05 за Києвом
const DAY = 86_400_000;
const ago = (d: number) => new Date(NOW - d * DAY).toISOString();
const veh = (id: string, name: string, status: string, days: number): BotVehicle =>
  ({ id, name, status, blocker: null, next_step: null, responsible: null, status_updated_at: ago(days), military_unit: null, open_jobs: 0, parts_waiting: 0 });
const VEHICLES = (): BotVehicle[] => [
  veh('АВТО-021', 'Toyota Hilux (білий)', 'В ремонті', 2),
  veh('АВТО-025', 'Mitsubishi L200 Warrior (третя)', 'В ремонті', 1),
  veh('АВТО-018', 'Suzuki Grand Vitara', 'Діагностика', 5),
  veh('АВТО-022', 'Nissan Pathfinder III', 'Готовий', 3),
  veh('АВТО-007', 'Volvo XC-90', 'Передано частині', 60),
  veh('АВТО-030', 'Toyota Land Cruiser 200', 'В ремонті', 10),
];

type Sent = { chat: number; html: string; buttons?: Button[][] };
type Edit = Sent & { messageId: number };
let sent: Sent[], edits: Edit[], answers: { id: string; text?: string }[], downloads: string[];
let saves: Parameters<PhotoSink['save']>[0][], attempts: number, failOn: number[], gate: Promise<void> | null;
const tg = {
  send: async (chat: number, html: string, buttons?: Button[][]) => { sent.push({ chat, html, buttons }); },
  edit: async (chat: number, messageId: number, html: string, buttons?: Button[][]) => { edits.push({ chat, messageId, html, buttons }); },
  answerCallback: async (id: string, text?: string) => { answers.push({ id, text }); },
  download: async (fileId: string) => { downloads.push(fileId); return new TextEncoder().encode(`bytes:${fileId}`); },
};
const sink: PhotoSink = {
  async save(p) {
    attempts++;
    const n = attempts;
    if (gate) await gate;
    if (failOn.includes(n)) throw new Error('Google Drive (завантаження): 500 backendError');
    saves.push(p);
    const car = `${p.vehicleId} ${p.vehicleName}`;
    return { fileId: `drive-${saves.length}`, folderName: p.kind === 'other' ? car : `${car} / ${KIND_FOLDER[p.kind]}`, folderUrl: `https://drive.google.com/drive/folders/${p.vehicleId}` };
  },
};
let md: MemoryData, mem: ReturnType<typeof createMemoryStore>, bot: ReturnType<typeof createBaseBot>;
const makeBot = (patch: Partial<BotConfig> = {}) =>
  createBaseBot(mem.store, tg, { appUrl: 'https://shtab.example', headIds: [OLEG], photoSink: sink, ...patch }, () => NOW);
beforeEach(() => {
  sent = []; edits = []; answers = []; downloads = []; saves = []; attempts = 0; failOn = []; gate = null;
  md = { vehicles: VEHICLES(), parts: [], payments: [], reports: [], money: {}, statuses: ['Прийнято', 'Діагностика', 'В ремонті', 'Готовий', 'Передано частині'],
    users: [{ telegram_id: IVAN, name: 'Іван', role: 'member', notify: false }] };
  mem = createMemoryStore(md, () => NOW);
  bot = makeBot();
});

let msgSeq = 100;
const base = (from: number) => ({ message_id: ++msgSeq, chat: { id: from, type: 'private' }, from: { id: from, first_name: 'Тест' }, date: Math.floor(NOW / 1000) });
const photo = (from: number, o: { caption?: string; album?: string; fileId?: string } = {}): TgUpdate => {
  const b = base(from);
  const id = o.fileId ?? `ph${b.message_id}`;
  return { message: { ...b, caption: o.caption, media_group_id: o.album, photo: [{ file_id: `${id}-small`, width: 90, height: 67, file_size: 1500 }, { file_id: id, width: 1280, height: 960, file_size: 180000 }] } };
};
const document = (from: number, d: TgDocument): TgUpdate => ({ message: { ...base(from), document: d } });
const tap = (from: number, data: string, messageId = 900): TgUpdate =>
  ({ callback_query: { id: `cb${Math.random()}`, from: { id: from }, data, message: { message_id: messageId, chat: { id: from } } } });
const datas = (s: Sent) => (s.buttons ?? []).flat().map(b => ('data' in b ? b.data : b.url));
const lastSent = () => sent[sent.length - 1];
const lastEdit = () => edits[edits.length - 1];
const lastAnswer = () => answers[answers.length - 1]?.text;

describe('фото: підпис «021 до» — одне натискання', () => {
  it('питання з готовою кнопкою; збереження — найбільший розмір фото, назва з датою й номером, результат замість питання', async () => {
    await bot.handleUpdate(photo(OLEG, { caption: '021 до', fileId: 'BIG1' }));
    expect(sent).toHaveLength(1);
    expect(sent[0].html).toBe('Отримав фото. Підпис: «021 до».\nЗберегти в <b>Toyota Hilux (білий)</b> (АВТО-021), у «До ремонту»?');
    expect(datas(sent[0])).toEqual(['us:1:АВТО-021:b', 'ua:1', 'ux:1']);
    expect(sent[0].buttons![0][0].text).toBe('Зберегти: АВТО-021 · до ремонту');

    await bot.handleUpdate(tap(OLEG, 'us:1:АВТО-021:b', 777));
    expect(downloads).toEqual(['BIG1']);
    expect(saves).toEqual([{ vehicleId: 'АВТО-021', vehicleName: 'Toyota Hilux (білий)', kind: 'before', fileName: '2026-11-18_АВТО-021_1.jpg', mime: 'image/jpeg', bytes: new TextEncoder().encode('bytes:BIG1') }]);
    expect(answers.map(a => a.text)).toEqual(['Зберігаю…']);
    expect(edits).toEqual([{
      chat: OLEG, messageId: 777, html: 'Збережено 1 фото → «АВТО-021 Toyota Hilux (білий) / До ремонту».',
      buttons: [[{ text: 'Відкрити папку на Drive', url: 'https://drive.google.com/drive/folders/АВТО-021' }],
        [{ text: 'Фото в картці авто', url: 'https://shtab.example/base/car/?id=%D0%90%D0%92%D0%A2%D0%9E-021&tab=photos' }]],
    }]);
    expect(mem.uploads[0]).toMatchObject({ status: 'saved', vehicle_id: 'АВТО-021', kind: 'before', drive_file_id: 'drive-1', error: null, caption: '021 до' });
  });
  it('підпис з назвою й кількома збігами: «тойота до» — вибір машини, кнопки одразу зберігають у «До ремонту»', async () => {
    await bot.handleUpdate(photo(OLEG, { caption: 'тойота до' }));
    expect(lastSent().html).toContain('Підходить кілька машин. Яка? Збережу у «До ремонту».');
    expect(datas(lastSent())).toEqual(['us:1:АВТО-021:b', 'us:1:АВТО-030:b', 'ua:1', 'ux:1']);
    await bot.handleUpdate(tap(OLEG, 'us:1:АВТО-030:b'));
    expect(saves[0]).toMatchObject({ vehicleId: 'АВТО-030', kind: 'before' });
  });
  it('машину впізнав, підпапку — ні: три кнопки підпапок', async () => {
    await bot.handleUpdate(photo(IVAN, { caption: 'Хайлюкс' }));
    expect(lastSent().html).toBe('Отримав фото. Підпис: «Хайлюкс».\n<b>Toyota Hilux (білий)</b> (АВТО-021). У яку папку?');
    expect(lastSent().buttons!.map(r => r.map(b => b.text))).toEqual([['До ремонту', 'Після ремонту'], ['Просто в папку машини'], ['Інше авто', 'Скасувати']]);
  });
});

describe('фото: без підпису', () => {
  it('пропонує машини в роботі (нещодавно оновлені першими) → підпапка → збережено', async () => {
    await bot.handleUpdate(photo(IVAN));
    const q = lastSent();
    expect(q.html).toContain('До якого авто це фото?');
    expect(q.html).toContain('Порада: з підписом «021 до»');
    expect(datas(q)).toEqual(['uv:1:АВТО-025', 'uv:1:АВТО-021', 'uv:1:АВТО-018', 'uv:1:АВТО-030', 'ua:1', 'ux:1']);
    expect(q.buttons!.at(-1)!.map(b => b.text)).toEqual(['Усі машини…', 'Скасувати']);
    await bot.handleUpdate(tap(IVAN, 'uv:1:АВТО-018'));
    expect(lastEdit().html).toBe('<b>Suzuki Grand Vitara</b> (АВТО-018). У яку папку?');
    await bot.handleUpdate(tap(IVAN, 'us:1:АВТО-018:a'));
    expect(saves[0]).toMatchObject({ vehicleId: 'АВТО-018', kind: 'after' });
    expect(lastEdit().html).toBe('Збережено 1 фото → «АВТО-018 Suzuki Grand Vitara / Після ремонту».');
  });
  it('«Усі машини…»: в роботі за номером, далі завершені за 30 днів; давно передані не показуються', async () => {
    await bot.handleUpdate(photo(OLEG));
    await bot.handleUpdate(tap(OLEG, 'ua:1'));
    const l = lastEdit();
    expect(l.html).toBe('До якого авто? Машини в роботі і завершені за останні 30 днів:');
    expect(datas(l)).toEqual(['uv:1:АВТО-018', 'uv:1:АВТО-021', 'uv:1:АВТО-025', 'uv:1:АВТО-030', 'uv:1:АВТО-022', 'ux:1']);
    expect(l.buttons![4][0].text).toBe('АВТО-022 Nissan Pathfinder III · завершено');
  });
  it('підпис без машини — пояснення і звичайний вибір', async () => {
    await bot.handleUpdate(photo(OLEG, { caption: 'вм’ятина на дверях' }));
    expect(lastSent().html).toContain('Номера чи назви машини в підписі не знайшов.');
    expect(datas(lastSent())[0]).toBe('uv:1:АВТО-025');
  });
});

describe('фото: альбоми', () => {
  it('альбом з трьох фото — одне питання; одне натискання зберігає всі три', async () => {
    await bot.handleUpdate(photo(OLEG, { album: 'A1', caption: 'хайлюкс після' }));
    await bot.handleUpdate(photo(OLEG, { album: 'A1' }));
    await bot.handleUpdate(photo(OLEG, { album: 'A1' }));
    expect(sent).toHaveLength(1);
    expect(sent[0].html).toContain('Отримав фото (альбом). Підпис: «хайлюкс після».');
    expect(datas(sent[0])[0]).toBe('us:1:АВТО-021:a');
    await bot.handleUpdate(tap(OLEG, 'us:1:АВТО-021:a'));
    expect(saves.map(s => s.fileName)).toEqual(['2026-11-18_АВТО-021_1.jpg', '2026-11-18_АВТО-021_2.jpg', '2026-11-18_АВТО-021_3.jpg']);
    expect(lastEdit().html).toBe('Збережено 3 фото → «АВТО-021 Toyota Hilux (білий) / Після ремонту».');
  });
  it('підпис прийшов не з першим фото альбому — уточнення; зберегти можна з будь-якого питання, друге стає неактивним', async () => {
    await bot.handleUpdate(photo(OLEG, { album: 'A2' }));
    await bot.handleUpdate(photo(OLEG, { album: 'A2', caption: '25' }));
    await bot.handleUpdate(photo(OLEG, { album: 'A2' }));
    expect(sent).toHaveLength(2);
    expect(sent[0].html).toContain('До якого авто ці фото?');
    expect(sent[1].html).toBe('Підпис до цього альбому: «25».\n<b>Mitsubishi L200 Warrior (третя)</b> (АВТО-025). У яку папку?');
    expect(datas(sent[1])).toEqual(['us:2:АВТО-025:b', 'us:2:АВТО-025:a', 'us:2:АВТО-025:n', 'ua:2', 'ux:2']);
    await bot.handleUpdate(tap(OLEG, 'us:2:АВТО-025:n'));
    expect(saves).toHaveLength(3);
    expect(saves.every(s => s.kind === 'other' && s.vehicleId === 'АВТО-025')).toBe(true);
    expect(lastEdit().html).toBe('Збережено 3 фото → «АВТО-025 Mitsubishi L200 Warrior (третя)».');
    await bot.handleUpdate(tap(OLEG, 'uv:1:АВТО-021'));
    expect(lastAnswer()).toBe('Ці фото вже збережено');
    expect(saves).toHaveLength(3);
  });
  it('Telegram повторив те саме повідомлення — друге питання не надсилається, запис один', async () => {
    const m = photo(OLEG, { caption: '021 до' });
    await bot.handleUpdate(m);
    await bot.handleUpdate(m);
    expect(sent).toHaveLength(1);
    expect(mem.uploads).toHaveLength(1);
  });
});

describe('фото: скасування, подвійне натискання, помилки', () => {
  it('«Скасувати» — нічого не зберігається; пізніше «Зберегти» — «скасовано»', async () => {
    await bot.handleUpdate(photo(OLEG, { caption: '021 до' }));
    await bot.handleUpdate(tap(OLEG, 'ux:1'));
    expect(lastEdit().html).toBe('Скасовано: 1 фото не збережено.');
    expect(lastEdit().buttons).toBeUndefined();
    expect(mem.uploads[0].status).toBe('cancelled');
    await bot.handleUpdate(tap(OLEG, 'us:1:АВТО-021:b'));
    expect(lastAnswer()).toBe('Ці фото скасовано');
    expect(saves).toEqual([]);
  });
  it('два натискання одночасно — файл кладеться один раз, друге отримує «Уже зберігаю…»', async () => {
    let release!: () => void;
    gate = new Promise(r => (release = r));
    await bot.handleUpdate(photo(OLEG, { caption: '021 до' }));
    const t1 = bot.handleUpdate(tap(OLEG, 'us:1:АВТО-021:b'));
    const t2 = bot.handleUpdate(tap(OLEG, 'us:1:АВТО-021:b'));
    await new Promise(r => setTimeout(r, 20));
    release();
    await Promise.all([t1, t2]);
    expect(saves).toHaveLength(1);
    expect(answers.map(a => a.text).sort()).toEqual(['Зберігаю…', 'Уже зберігаю…']);
  });
  it('збій на одному фото альбому: «2 з 3», кнопка повтору; повтор кладе лише незбережене', async () => {
    failOn = [2];
    await bot.handleUpdate(photo(OLEG, { album: 'A3', caption: '021 до' }));
    await bot.handleUpdate(photo(OLEG, { album: 'A3' }));
    await bot.handleUpdate(photo(OLEG, { album: 'A3' }));
    await bot.handleUpdate(tap(OLEG, 'us:1:АВТО-021:b'));
    expect(saves).toHaveLength(2);
    expect(lastEdit().html).toBe('Збережено 2 з 3 фото → «АВТО-021 Toyota Hilux (білий) / До ремонту». Не вдалося 1: Google Drive (завантаження): 500 backendError');
    expect(datas(lastEdit())[0]).toBe('us:1:АВТО-021:b');
    expect(lastEdit().buttons![0][0].text).toBe('Спробувати ще раз');
    expect(mem.uploads.map(u => u.status)).toEqual(['saved', 'pending', 'saved']);
    expect(mem.uploads[1].error).toContain('500');
    await bot.handleUpdate(tap(OLEG, 'us:1:АВТО-021:b'));
    expect(saves).toHaveLength(3);
    expect(saves[2].fileName).toBe('2026-11-18_АВТО-021_2.jpg');
    expect(lastEdit().html).toBe('Збережено 3 фото → «АВТО-021 Toyota Hilux (білий) / До ремонту».');
  });
  it('нічого не вдалося — пояснення, «Спробувати ще раз» і «Скасувати»', async () => {
    failOn = [1];
    await bot.handleUpdate(photo(OLEG, { caption: '021 до' }));
    await bot.handleUpdate(tap(OLEG, 'us:1:АВТО-021:b'));
    expect(lastEdit().html).toBe('Не вдалося зберегти 1 фото: Google Drive (завантаження): 500 backendError');
    expect(datas(lastEdit())).toEqual(['us:1:АВТО-021:b', 'ux:1']);
  });
  it('зависле «зберігаю» (функцію перервали) через 5 хвилин можна повторити', async () => {
    await bot.handleUpdate(photo(OLEG, { caption: '021 до' }));
    mem.uploads[0].status = 'saving';
    mem.uploads[0].updated_at = new Date(NOW - 2 * 60_000).toISOString();
    await bot.handleUpdate(tap(OLEG, 'us:1:АВТО-021:b'));
    expect(lastAnswer()).toBe('Уже зберігаю…');
    mem.uploads[0].updated_at = new Date(NOW - 6 * 60_000).toISOString();
    await bot.handleUpdate(tap(OLEG, 'us:1:АВТО-021:b'));
    expect(saves).toHaveLength(1);
  });
});

describe('фото: що приймається і хто може', () => {
  it('зображення файлом (HEIC) приймається; рахунок PDF — ні, з поясненням про приватність; завеликий файл і відео — пояснення', async () => {
    await bot.handleUpdate(document(OLEG, { file_id: 'D1', file_name: 'IMG_4567.HEIC', mime_type: 'application/octet-stream', file_size: 3_000_000 }));
    expect(lastSent().html).toContain('Отримав фото.');
    expect(mem.uploads[0]).toMatchObject({ mime: 'image/heic', file_name: 'IMG_4567.HEIC', file_size: 3_000_000 });
    await bot.handleUpdate(document(IVAN, { file_id: 'D2', file_name: 'Рахунок 15.pdf', mime_type: 'application/pdf' }));
    expect(lastSent().html).toContain('Документи через бота не зберігаю — лише фото. Папку «Фото» бачить уся команда, а в рахунках і актах бувають суми та особисті дані.');
    expect(lastSent().html).toContain('передайте координатору');
    await bot.handleUpdate(document(OLEG, { file_id: 'D4', file_name: 'logo.svg', mime_type: 'image/svg+xml' }));
    expect(lastSent().html).toContain('Документи через бота не зберігаю');
    await bot.handleUpdate(document(OLEG, { file_id: 'D3', file_name: 'big.jpg', mime_type: 'image/jpeg', file_size: 25_000_000 }));
    expect(lastSent().html).toContain('більший за 20 МБ');
    await bot.handleUpdate({ message: { ...base(OLEG), video: { file_id: 'V' } } });
    expect(lastSent().html).toContain('Відео я не зберігаю');
    expect(mem.uploads).toHaveLength(1);
  });
  it('відмова на альбом — одним повідомленням, а не на кожне фото чи файл', async () => {
    bot = makeBot({ photoSink: undefined });
    for (let i = 0; i < 3; i++) await bot.handleUpdate(photo(OLEG, { album: 'NS' }));
    expect(sent.map(s => s.html)).toEqual(['Фото через бота ще не налаштовані. Поки що кладіть їх у папку авто на Google Drive.']);
    bot = makeBot();
    sent = [];
    for (let i = 0; i < 2; i++) await bot.handleUpdate({ message: { ...base(IVAN), media_group_id: 'PDFS', document: { file_id: `P${i}`, file_name: `акт ${i}.pdf`, mime_type: 'application/pdf' } } });
    expect(sent).toHaveLength(1);
    expect(sent[0].html).toContain('Документи через бота не зберігаю');
  });
  it('лише керівники (photoUploaders: heads): член команди отримує пояснення, керівник — питання', async () => {
    bot = makeBot({ photoUploaders: 'heads' });
    await bot.handleUpdate(photo(IVAN, { caption: '021 до' }));
    expect(lastSent().html).toContain('Фото через бота приймає лише координатор');
    expect(mem.uploads).toHaveLength(0);
    await bot.handleUpdate(photo(OLEG, { caption: '021 до' }));
    expect(datas(lastSent())[0]).toBe('us:1:АВТО-021:b');
    await bot.handleUpdate(tap(IVAN, 'us:1:АВТО-021:b'));
    expect(lastAnswer()).toBe('Фото через бота приймає лише координатор');
    await bot.handleUpdate(msgText(IVAN, '/help'));
    expect(lastSent().html).not.toContain('надішліть фото');
  });
  it('чужі кнопки не діють: інший чат не збереже й не скасує чужі фото; зіпсовані дані — «не знайдено»', async () => {
    await bot.handleUpdate(photo(OLEG, { caption: '021 до' }));
    await bot.handleUpdate(tap(IVAN, 'us:1:АВТО-021:b'));
    expect(lastAnswer()).toBe('Ці фото не знайдено');
    await bot.handleUpdate(tap(IVAN, 'ux:1'));
    expect(lastAnswer()).toBe('Ці фото не знайдено');
    await bot.handleUpdate(tap(OLEG, 'us:abc:АВТО-021:b'));
    expect(lastAnswer()).toBe('Ці фото не знайдено');
    await bot.handleUpdate(tap(OLEG, 'us:1:АВТО-999:b'));
    expect(lastAnswer()).toBe('Цієї машини вже немає в обліку');
    await bot.handleUpdate(tap(OLEG, 'us:1:АВТО-021:z'));
    expect(lastAnswer()).toBe('Ця кнопка вже не діє');
    expect(saves).toEqual([]);
    expect(mem.uploads[0].status).toBe('pending');
  });
  it('незнайомий надсилає фото — лише запит на доступ, фото не записується', async () => {
    await bot.handleUpdate(photo(STRANGER));
    expect(sent[0].html).toContain('вас має підключити координатор');
    expect(mem.uploads).toHaveLength(0);
  });
  it('/help розповідає про фото, коли сховище налаштоване', async () => {
    await bot.handleUpdate(msgText(IVAN, '/help'));
    expect(lastSent().html).toContain('надішліть фото (можна альбомом)');
  });
});

describe('фото: розбір підпису, тип файлу, назва', () => {
  const list = VEHICLES();
  const ids = (c: string) => parseCaption(c, list).vehicles.map(v => v.id);
  it('підпис: номер, назва, «до»/«після»; «до» посеред фрази — прийменник', () => {
    expect(parseCaption('021 до', list)).toMatchObject({ kind: 'before' });
    expect(ids('021 до')).toEqual(['АВТО-021']);
    expect(parseCaption('до ремонту хайлюкс', list).kind).toBe('before');
    expect(ids('до ремонту хайлюкс')).toEqual(['АВТО-021']);
    expect(parseCaption('фото до хайлюкса', list).kind).toBeNull();
    expect(ids('фото до хайлюкса')).toEqual(['АВТО-021']);
    expect(parseCaption('Після ремонту 25', list).kind).toBe('after');
    expect(ids('Після ремонту 25')).toEqual(['АВТО-025']);
    expect(parseCaption('Hilux after', list)).toMatchObject({ kind: 'after' });
    expect(ids('тойота')).toEqual(['АВТО-021', 'АВТО-030']);
    expect(parseCaption('до', list)).toEqual({ vehicles: [], kind: 'before' });
    expect(ids('021 білий')).toEqual(['АВТО-021']); // номер важить більше за слова
    expect(ids('Toyota 2008')).toEqual(['АВТО-021', 'АВТО-030']); // рік — не номер авто
  });
  it('тип: найбільше фото; HEIC з octet-stream за розширенням; svg і pdf — ні', () => {
    expect(mediaOf({ message_id: 1, chat: { id: 1 }, photo: [{ file_id: 'b', width: 1280, height: 960 }, { file_id: 's', width: 90, height: 60 }] }))
      .toEqual({ ok: true, file_id: 'b', mime: 'image/jpeg', file_name: null, file_size: null });
    expect(mediaOf({ message_id: 1, chat: { id: 1 }, document: { file_id: 'd', file_name: 'a.heic' } })).toMatchObject({ ok: true, mime: 'image/heic' });
    expect(mediaOf({ message_id: 1, chat: { id: 1 }, document: { file_id: 'd', file_name: 'a.jpg', mime_type: 'application/pdf' } })).toEqual({ ok: false, reason: 'not-image' });
    expect(mediaOf({ message_id: 1, chat: { id: 1 }, text: 'привіт' })).toBeNull();
  });
  it('назва файлу: дата за Києвом з повідомлення (не UTC), розширення з типу', () => {
    expect(uploadFileName({ id: 7, mime: 'image/jpeg', file_name: null, sent_at: '2026-11-17T22:30:00Z' }, 'АВТО-021')).toBe('2026-11-18_АВТО-021_7.jpg');
    expect(uploadFileName({ id: 8, mime: 'image/heic', file_name: 'IMG.HEIC', sent_at: '2026-11-17T10:00:00Z' }, 'АВТО-021')).toBe('2026-11-17_АВТО-021_8.heic');
    expect(uploadFileName({ id: 9, mime: 'image/x-weird', file_name: 'a.PNG', sent_at: '2026-11-17T10:00:00Z' }, 'АВТО-021')).toBe('2026-11-17_АВТО-021_9.png');
    expect(uploadFileName({ id: 10, mime: 'image/x-weird', file_name: null, sent_at: '2026-11-17T10:00:00Z' }, 'АВТО-021')).toBe('2026-11-17_АВТО-021_10.jpg');
  });
});

function msgText(from: number, text: string): TgUpdate { return { message: { ...base(from), text } }; }
