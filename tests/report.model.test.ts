import { describe, it, expect } from 'vitest';
import { demoData, draftReport } from '../src/lib/base/demoData';
import { buildDonorReport, money, plural, looksPrivate, type ReportInput } from '../src/lib/base/report/model';
import { inferCategory } from '../src/lib/base/report/categories';

const NOW = new Date('2026-11-17T10:00:00Z');
function input(id = 'АВТО-003', patch: Partial<ReportInput> = {}): ReportInput {
  const d = demoData(NOW);
  const vehicle = d.vehicles.find(v => v.id === id)!;
  return {
    vehicle, jobs: d.jobs.filter(j => j.vehicle_id === id), parts: d.parts.filter(p => p.vehicle_id === id),
    finance: d.finance.filter(f => f.vehicle_id === id), report: d.reports.find(r => r.vehicle_id === id) ?? null, now: NOW, ...patch,
  };
}
const SECRETS = ['TEST-VIN-0003', 'АА0003ТТ', 'Контакт Частини 1', 'Майстер Петро', 'Маляр Тест', 'Місто 2', 'Місто 3', 'Постачальник 2', 'Особа Б', 'Рахунок №17', 'ФОП Тестовий', 'Службова примітка', 'Координатор'];

describe('модель звіту: гроші', () => {
  const m = buildDonorReport(input());
  it('загальна сума = сума витрат авто (перераховано незалежно)', () => {
    // 4100.5 + 18000 + 3200 + 9500 + 7800 + 6450 + 5300 + 15000 + 2750
    expect(m.figures.total).toBe(72100.5);
    expect(m.figures.pending).toBe(15000);
    expect(m.figures.paid).toBe(57100.5);
  });
  it('статті в сумі дають загальну суму, частки — 100%', () => {
    const sum = m.spend.reduce((a, s) => a + Math.round(s.amount * 100), 0) / 100;
    expect(sum).toBe(m.figures.total);
    expect(Math.abs(m.spend.reduce((a, s) => a + s.share, 0) - 1)).toBeLessThan(1e-9);
  });
  it('статті: вказані вручну + визначені за описом', () => {
    const by = Object.fromEntries(m.spend.map(s => [s.category, s.amount]));
    expect(by).toEqual({ 'Запчастини': 4100.5 + 6450 + 5300 + 2750, 'Доставка': 18000, 'Фарбування': 15000, 'Оформлення': 9500, 'Роботи СТО': 7800, 'Пальне': 3200 });
    expect(m.spend.find(s => s.category === 'Доставка')!.inferred).toBe(false);
    expect(m.spend.find(s => s.category === 'Роботи СТО')!.inferred).toBe(true);
  });
  it('джерела коштів', () => {
    expect(m.sources).toEqual([{ source: 'Збір', amount: 72100.5 - 4100.5 - 6450 }, { source: 'Фандрайзинг', amount: 4100.5 + 6450 }]);
  });
  it('рахунки окремо: усі 9, за датою, неоплачений позначено', () => {
    expect(m.invoices!.length).toBe(9);
    expect(m.invoices![0].label).toBe('Доставка авто з ЄС до СТО');
    expect(m.invoices!.find(i => i.label === 'Фарбування кузова')!.paid).toBe(false);
  });
  it('підпис рахунку для донорів замінює опис; рахунки можна сховати', () => {
    const rep = { ...draftReport('АВТО-003'), row_labels: { '3': 'Комплект ГРМ' } };
    expect(buildDonorReport(input('АВТО-003', { report: rep })).invoices!.find(i => i.id === 3)!.label).toBe('Комплект ГРМ');
    expect(buildDonorReport(input('АВТО-003', { report: { ...rep, show_invoices: false } })).invoices).toBeNull();
  });
  it('чужі й загальні витрати не потрапляють', () => {
    const d = demoData(NOW);
    const m2 = buildDonorReport(input('АВТО-003', { finance: d.finance }));
    expect(m2.figures.total).toBe(72100.5);
  });
});

describe('модель звіту: приватність', () => {
  it('у моделі немає VIN, номера, імен, постачальників, місць, номерів документів, приміток', () => {
    const json = JSON.stringify(buildDonorReport(input()));
    for (const s of SECRETS) expect(json, s).not.toContain(s);
  });
  it('підрозділ: показується за замовчуванням, ховається галочкою, можна перейменувати', () => {
    expect(buildDonorReport(input()).unit).toBe('Частина 1');
    const hidden = buildDonorReport(input('АВТО-004', { report: { ...draftReport('АВТО-004'), show_unit: false } }));
    expect(hidden.unit).toBeNull();
    expect(JSON.stringify(hidden)).not.toContain('Частина 3');
    expect(hidden.timeline.at(-1)!.label).toBe('Передано військовим');
    expect(buildDonorReport(input('АВТО-004', { report: { ...draftReport('АВТО-004'), unit_label: '46 ОАеМБр' } })).unit).toBe('46 ОАеМБр');
  });
  it('попередження про підпис, схожий на компанію/ім’я/телефон', () => {
    const rep = { ...draftReport('АВТО-003'), row_labels: { '5': 'Перевізник ФОП Іваненко' } };
    expect(buildDonorReport(input('АВТО-003', { report: rep })).warnings.some(w => w.includes('ФОП Іваненко'))).toBe(true);
    expect(looksPrivate('ТОВ «Ромашка»')).toBe(true);
    expect(looksPrivate('+38 067 123 45 67')).toBe(true);
    expect(looksPrivate('Колодки й диски гальмівні')).toBe(false);
    expect(looksPrivate('Топлива фільтр')).toBe(false); // «ТОВ» усередині слова — не компанія
  });
});

describe('модель звіту: історія, хронологія, попередження', () => {
  const m = buildDonorReport(input());
  it('історія з даних: без undefined/null, з правильними відмінками', () => {
    const text = m.story.paragraphs.join(' ');
    expect(m.story.auto).toBe(true);
    expect(text).not.toMatch(/undefined|null|NaN/);
    expect(text).toContain('Позашляховик «Тестовий Джип В» прибув на СТО «База» 02.10.2026.');
    expect(text).toContain('За 38 днів на СТО виконано 6 робіт');
    expect(text).toContain('Встановлено 13 запчастин (8 позицій).');
    expect(text).toContain(`Загальна вартість — ${money(72100.5)}.`);
    expect(text).toContain('Машина готова до передачі: Частина 1.');
  });
  it('власна історія керівника замінює автоматичну', () => {
    const own = buildDonorReport(input('АВТО-003', { report: { ...draftReport('АВТО-003'), story: 'Перший абзац.\n\nДругий\nабзац.' } }));
    expect(own.story).toEqual({ paragraphs: ['Перший абзац.', 'Другий абзац.'], auto: false });
  });
  it('хронологія за датами', () => {
    expect(m.timeline.map(t => t.label)).toEqual(['Авто прибуло на СТО', 'Почали ремонт', 'Ремонт завершено']);
    expect(m.timeline[0].date).toBe('02.10.2026');
  });
  it('тривалість: від прибуття до останньої роботи (або передачі)', () => {
    expect(m.figures.days).toBe(38); // 02.10 → 09.11
    expect(buildDonorReport(input('АВТО-004')).figures.days).toBe(35); // передано 12.11, прибуло 08.10
  });
  it('попередження: автоісторія, неоплачене, статті за описом, немає фото, призначення', () => {
    const w = m.warnings.join('\n');
    expect(w).toMatch(/автоматично/); expect(w).toMatch(/не оплачено/); expect(w).toMatch(/Статтю 4 витрат/); expect(w).toMatch(/Немає фото/); expect(w).toMatch(/призначення/);
    expect(w).not.toMatch(/Немає витрат:/); // доставка, пальне, оформлення є
  });
  it('попередження: немає доставки/пального/оформлення', () => {
    expect(buildDonorReport(input('АВТО-004')).warnings.join('\n')).toContain('Немає витрат: доставка, пальне та оформлення');
  });
  it('чернетка за замовчуванням, фінальна — без позначки', () => {
    expect(m.draft).toBe(true);
    expect(buildDonorReport(input('АВТО-003', { final: true })).draft).toBe(false);
  });
});

describe('допоміжне', () => {
  it('гроші з нерозривними пробілами', () => { expect(money(72100.5)).toBe('72 100,50 грн'); expect(money(900)).toBe('900,00 грн'); });
  it('відмінки', () => {
    expect([1, 2, 5, 11, 21, 22, 25, 111, 104].map(n => plural(n, ['день', 'дні', 'днів']))).toEqual(['день', 'дні', 'днів', 'днів', 'день', 'дні', 'днів', 'днів', 'дні']);
  });
  it('стаття за описом', () => {
    const cases: [string, string][] = [
      ['Пальне на перегін', 'Пальне'], ['Паливний насос', 'Запчастини'], ['Дизельне паливо 60 л', 'Пальне'], ['Доставка авто з ЄС', 'Доставка'],
      ['Перегін Львів — Житомир', 'Доставка'], ['Розмитнення', 'Оформлення'], ['Фарбування кузова', 'Фарбування'], ['Роботи з ремонту підвіски', 'Роботи СТО'],
      ['Деталі підвіски', 'Запчастини'], ['Олива та фільтри', 'Запчастини'], ['Ремонт двигуна', 'Роботи СТО'], ['Канцтовари', 'Інше'], ['', 'Інше'],
    ];
    for (const [t, c] of cases) expect(inferCategory(t), t).toBe(c);
    expect(inferCategory('Кронштейн бампера', ['Кронштейн бампера'])).toBe('Запчастини');
  });
});
