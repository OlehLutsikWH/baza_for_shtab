// ВИГАДАНІ дані для демо-режиму й тестів. Жодних реальних авто, людей чи сум.
import type { Vehicle, Job, Part, FinanceItem, DocumentItem, DonorReportRow } from './types';

const daysAgo = (n: number, now = new Date()) => new Date(now.getTime() - n * 86_400_000).toISOString();
const dateAgo = (n: number, now = new Date()) => daysAgo(n, now).slice(0, 10);

export const draftReport = (vehicle_id: string): DonorReportRow => ({
  vehicle_id, status: 'Чернетка', story: null, thanks: null, unit_label: null, show_unit: true, show_invoices: true,
  row_labels: {}, photo_paths: [], storage_path: null, generated_at: null,
});

export function demoData(now = new Date()) {
  const v = (id: string, name: string, o: Partial<Vehicle>): Vehicle => ({
    id, name, vehicle_type: 'Позашляховик', vin: null, plate: null, status: 'В ремонті', requested_by: null,
    military_unit: null, purpose: null, received_on: dateAgo(40, now), handed_over_on: null, notes: null,
    blocker: null, next_step: null, responsible: null, status_updated_at: daysAgo(1, now), legacy_links: null, ...o,
  });
  const vehicles: Vehicle[] = [
    v('АВТО-001', 'Тестовий Пікап А', { vehicle_type: 'Пікап', status: 'В ремонті', military_unit: 'Частина 1',
      blocker: 'Чекаємо паливний насос від постачальника', next_step: 'Забрати насос у Дніпрі', responsible: 'Майстер Іван', status_updated_at: daysAgo(2, now), vin: 'TEST-VIN-0001', plate: 'АА0001ТТ' }),
    v('АВТО-002', 'Тестовий Бус Б', { vehicle_type: 'Мікроавтобус', status: 'Діагностика', military_unit: 'Частина 2',
      next_step: 'Провести діагностику ходової', responsible: 'Майстер Петро', status_updated_at: daysAgo(12, now) }),
    v('АВТО-003', 'Тестовий Джип В', { status: 'Готовий', military_unit: 'Частина 1', next_step: 'Домовитись про передачу', responsible: 'Координатор',
      status_updated_at: daysAgo(3, now), received_on: dateAgo(46, now), purpose: 'евакуація поранених і підвезення боєкомплекту',
      vin: 'TEST-VIN-0003', plate: 'АА0003ТТ', requested_by: 'Контакт Частини 1', notes: 'Службова примітка, не для звіту' }),
    v('АВТО-004', 'Тестовий Пікап Г', { vehicle_type: 'Пікап', status: 'Передано частині', military_unit: 'Частина 3', handed_over_on: dateAgo(5, now), status_updated_at: daysAgo(5, now) }),
    v('АВТО-005', 'Тестовий Джип Д', { status: 'Прийнято', military_unit: 'Частина 2', status_updated_at: daysAgo(0, now), received_on: dateAgo(0, now) }),
    v('АВТО-006', 'Тестовий Бус Е', { vehicle_type: 'Мікроавтобус', status: 'В ремонті', military_unit: 'Частина 3',
      blocker: 'Немає рішення по двигуну: ремонт чи заміна', responsible: 'Координатор', status_updated_at: daysAgo(9, now) }),
  ];
  const job = (id: number, vehicle_id: string, o: Partial<Job>): Job => ({
    id, vehicle_id, nomenclature_id: null, description: null, executor: null, location: null, status: 'Заплановано',
    started_on: null, finished_on: null, notes: null, duration_days: null, ...o,
  });
  const done = (id: number, vehicle_id: string, description: string, start: number, end: number, extra: Partial<Job> = {}) =>
    job(id, vehicle_id, { description, status: 'Завершено', started_on: dateAgo(start, now), finished_on: dateAgo(end, now), duration_days: start - end, ...extra });
  const jobs: Job[] = [
    job(1, 'АВТО-001', { description: 'Заміна паливного насоса', executor: 'Майстер Іван', location: 'Місто 1', status: 'В процесі', started_on: dateAgo(6, now) }),
    job(2, 'АВТО-001', { description: 'Ремонт електропроводки', executor: 'Майстер Іван', location: 'Місто 1', status: 'Завершено', started_on: dateAgo(20, now), finished_on: dateAgo(17, now), duration_days: 3 }),
    job(3, 'АВТО-002', { description: 'Діагностика ходової', executor: 'Майстер Петро', status: 'Заплановано' }),
    job(4, 'АВТО-006', { description: 'Капітальний ремонт двигуна', executor: 'Майстер Іван', status: 'Заплановано' }),
    job(5, 'АВТО-003', { description: 'Заміна ременя ГРМ', executor: 'Майстер Петро', status: 'Завершено', started_on: dateAgo(14, now), finished_on: dateAgo(10, now), duration_days: 4 }),
    done(6, 'АВТО-003', 'Комплексна діагностика', 43, 42, { executor: 'Майстер Петро', location: 'Місто 2' }),
    done(7, 'АВТО-003', 'Ремонт передньої підвіски', 36, 30, { executor: 'Майстер Петро', location: 'Місто 2' }),
    done(8, 'АВТО-003', 'Заміна гальмівних колодок і дисків', 29, 28, { executor: 'Майстер Петро' }),
    done(9, 'АВТО-003', 'Фарбування кузова в захисний колір', 26, 17, { executor: 'Маляр Тест', location: 'Місто 3' }),
    done(10, 'АВТО-003', 'Заміна оливи та фільтрів', 8, 8, { executor: 'Майстер Петро' }),
    done(11, 'АВТО-004', 'Заміна зчеплення', 30, 26, { executor: 'Майстер Іван' }),
  ];
  const part = (id: number, vehicle_id: string, o: Partial<Part>): Part => ({
    id, vehicle_id, name: '', qty: 1, status: 'Замовлено', supplier: null, cost_total: null, ordered_on: null, received_on: null, notes: null, ...o,
  });
  const installed = (id: number, vehicle_id: string, name: string, qty = 1) =>
    part(id, vehicle_id, { name, qty, status: 'Встановлено', supplier: 'Постачальник 2', ordered_on: dateAgo(35, now), received_on: dateAgo(31, now) });
  const parts: Part[] = [
    part(1, 'АВТО-001', { name: 'Паливний насос', status: 'Замовлено', supplier: 'Постачальник 1', cost_total: 6200, ordered_on: dateAgo(5, now) }),
    part(2, 'АВТО-001', { name: 'Фільтр паливний', qty: 2, status: 'Встановлено', supplier: 'Постачальник 1', cost_total: 900, ordered_on: dateAgo(15, now), received_on: dateAgo(12, now) }),
    part(3, 'АВТО-003', { name: 'Ремінь ГРМ (комплект)', status: 'Встановлено', supplier: 'Постачальник 2', cost_total: 4100.5, ordered_on: dateAgo(20, now), received_on: dateAgo(16, now) }),
    installed(4, 'АВТО-003', 'Сайлентблоки важелів', 4),
    installed(5, 'АВТО-003', 'Кульова опора', 2),
    installed(6, 'АВТО-003', 'Колодки гальмівні (комплект)'),
    installed(7, 'АВТО-003', 'Диск гальмівний', 2),
    installed(8, 'АВТО-003', 'Олива моторна, 5 л'),
    installed(9, 'АВТО-003', 'Фільтр оливний'),
    installed(10, 'АВТО-003', 'Фільтр повітряний'),
    installed(11, 'АВТО-004', 'Комплект зчеплення'),
  ];
  const fin = (id: number, vehicle_id: string | null, o: Partial<FinanceItem>): FinanceItem => ({
    id, vehicle_id, scope: vehicle_id ? 'vehicle' : 'unassigned', amount: 0, spent_on: null, purpose: null, doc_ref: null, source: 'Збір',
    person_dejure: null, pay_status: 'Оплачено', paid_on: null, legacy_links: null, category: null, ...o,
  });
  const finance: FinanceItem[] = [
    fin(1, 'АВТО-001', { amount: 6200, spent_on: dateAgo(5, now), purpose: 'Паливний насос', doc_ref: 'Рахунок №1', person_dejure: 'Особа А', pay_status: 'Очікує оплати', category: 'Запчастини' }),
    fin(2, 'АВТО-001', { amount: 900, spent_on: dateAgo(15, now), purpose: 'Фільтри', doc_ref: 'Накладна', person_dejure: 'Особа А', paid_on: dateAgo(14, now), legacy_links: [{ field: 'doc', url: 'https://example.test/pay-1', text: 'Платіжка' }] }),
    fin(3, 'АВТО-003', { amount: 4100.5, spent_on: dateAgo(20, now), purpose: 'Ремінь ГРМ (комплект)', source: 'Фандрайзинг', person_dejure: 'Особа Б', paid_on: dateAgo(19, now), doc_ref: 'Рахунок №17 ФОП Тестовий' }),
    fin(4, null, { amount: 32100, spent_on: dateAgo(30, now), purpose: 'Оренда майданчика', scope: 'general' }),
    fin(5, 'АВТО-003', { amount: 18000, spent_on: dateAgo(47, now), purpose: 'Доставка авто з ЄС до СТО', category: 'Доставка', paid_on: dateAgo(47, now) }),
    fin(6, 'АВТО-003', { amount: 3200, spent_on: dateAgo(46, now), purpose: 'Пальне на перегін', category: 'Пальне', paid_on: dateAgo(46, now) }),
    fin(7, 'АВТО-003', { amount: 9500, spent_on: dateAgo(44, now), purpose: 'Реєстрація і сертифікація авто', category: 'Оформлення', paid_on: dateAgo(44, now) }),
    fin(8, 'АВТО-003', { amount: 7800, spent_on: dateAgo(30, now), purpose: 'Роботи з ремонту підвіски', person_dejure: 'Особа Б', paid_on: dateAgo(29, now) }),
    fin(9, 'АВТО-003', { amount: 6450, spent_on: dateAgo(34, now), purpose: 'Деталі підвіски: сайлентблоки, кульові опори', source: 'Фандрайзинг', paid_on: dateAgo(33, now) }),
    fin(10, 'АВТО-003', { amount: 5300, spent_on: dateAgo(29, now), purpose: 'Колодки й диски гальмівні', category: 'Запчастини', paid_on: dateAgo(29, now) }),
    fin(11, 'АВТО-003', { amount: 15000, spent_on: dateAgo(17, now), purpose: 'Фарбування кузова', category: 'Фарбування', person_dejure: 'Особа Б', pay_status: 'Очікує оплати' }),
    fin(12, 'АВТО-003', { amount: 2750, spent_on: dateAgo(8, now), purpose: 'Олива та фільтри', paid_on: dateAgo(8, now) }),
    fin(13, 'АВТО-004', { amount: 11200, spent_on: dateAgo(28, now), purpose: 'Комплект зчеплення і робота', category: 'Роботи СТО', paid_on: dateAgo(27, now) }),
  ];
  const documents: DocumentItem[] = [
    { id: 1, vehicle_id: 'АВТО-001', doc_type: 'Акт приймання-передачі', storage_path: null, doc_date: dateAgo(40, now), notes: null,
      legacy_links: [{ field: 'file', url: 'https://example.test/act-1', text: 'Акт приймання' }] },
  ];
  // Як і тригер у базі: завершені авто одразу мають чернетку звіту.
  const reports: DonorReportRow[] = vehicles.filter(x => x.status === 'Готовий' || x.status === 'Передано частині').map(x => draftReport(x.id));
  return { vehicles, jobs, parts, finance, documents, reports,
    statuses: ['Прийнято', 'Діагностика', 'В ремонті', 'Готовий', 'Передано частині'] };
}
