// Модель звіту для донорів: усе, що піде у PDF, зібране з даних авто.
// ПРИВАТНІСТЬ: у модель свідомо НЕ копіюються VIN, держномер, хто надіслав запит, відповідальний,
// виконавці, місця робіт, постачальники, особи (де-юре/де-факто), контакти, номери документів і примітки.
// Підрозділ — лише якщо show_unit. Підпис кожного рахунку керівник може переписати (row_labels).
import type { DonorReportRow, FinanceItem, Job, Part, Vehicle } from '../types';
import { BRAND } from './brand';
import { categoryOf, REQUIRED_LOGISTICS } from './categories';

export interface ReportImage { src: string; caption: string | null; kind: 'до' | 'після' | null }

export interface ReportInput {
  vehicle: Vehicle; jobs: Job[]; parts: Part[];
  /** витрати саме цього авто (scope = vehicle) */
  finance: FinanceItem[];
  report: DonorReportRow | null;
  now: Date;
  /** фото, вже перетворені на джерела для PDF (data URI або тимчасові посилання) */
  images?: ReportImage[];
  /** скільки спільних платежів на кілька авто ще не розподілено (вони не входять у звіт) */
  sharedUnallocated?: number;
  /** фінальна версія — без позначки «чернетка» */
  final?: boolean;
}

export interface SpendRow { category: string; amount: number; share: number; inferred: boolean }
export interface InvoiceRow { id: number; date: string | null; label: string; category: string; amount: number; paid: boolean }

export interface DonorReportModel {
  draft: boolean;
  reportNo: string;
  generatedOn: string;
  vehicle: { id: string; name: string; type: string | null; purpose: string | null };
  status: string;
  /** назва підрозділу, якщо її дозволено показувати */
  unit: string | null;
  handedOverOn: string | null;
  figures: { total: number; paid: number; pending: number; days: number | null; jobsDone: number; partsInstalled: number; partItems: number };
  story: { paragraphs: string[]; auto: boolean };
  timeline: { date: string; label: string }[];
  works: { title: string; period: string | null; days: number | null; done: boolean }[];
  parts: { name: string; qty: number; installed: boolean }[];
  spend: SpendRow[];
  sources: { source: string; amount: number }[];
  /** null — керівник вирішив не показувати рахунки окремо */
  invoices: InvoiceRow[] | null;
  images: ReportImage[];
  thanks: string;
  about: string;
  /** лише для екрана керівника, у PDF не йде */
  warnings: string[];
}

// ---------- форматування (без вузьких пробілів: не всі шрифти мають U+202F) ----------
const NBSP = ' ';
export function money(n: number): string {
  const [int, frac] = Math.abs(n).toFixed(2).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return `${n < 0 ? '−' : ''}${grouped},${frac}${NBSP}грн`;
}
/** Ціле число гривень для великих цифр: копійки відкидаються, щоб не завищувати суму. */
export function moneyShort(n: number): string {
  const r = Math.floor(n);
  return `${String(r).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP)}${NBSP}грн`;
}
export function dateUa(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : null;
}
export function plural(n: number, [one, few, many]: [string, string, string]): string {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}
const DAY = 86_400_000;
const toDay = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const isoOf = (d: Date) => d.toISOString().slice(0, 10);
export function daysBetween(a: string, b: string): number { return Math.round((toDay(b) - toDay(a)) / DAY); }
const maxIso = (xs: (string | null)[]) => xs.filter((x): x is string => !!x).sort().at(-1) ?? null;
const minIso = (xs: (string | null)[]) => xs.filter((x): x is string => !!x).sort()[0] ?? null;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const low = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
// «та» перед останнім: назви робіт самі часто містять «і» («колодок і дисків»)
const list = (xs: string[]) => xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} та ${xs.at(-1)}`;

/** Схоже на назву компанії, ім'я чи телефон — такий підпис варто переписати для донорів. */
export function looksPrivate(text: string): boolean {
  return /(?<![а-яіїєґa-z])(ФОП|ТОВ|ПП|ПрАТ|ТзОВ)(?![а-яіїєґa-z])/iu.test(text) || /\+?\d[\d\s()-]{8,}\d/.test(text) || /@/.test(text);
}

export function buildDonorReport(input: ReportInput): DonorReportModel {
  const { vehicle: v, report, now } = input;
  const r = report;
  const final = ['Готовий', 'Передано частині'];
  const partNames = input.parts.map(p => p.name);

  // ----- роботи й запчастини -----
  const jobs = [...input.jobs].sort((a, b) => (a.started_on ?? a.finished_on ?? '9').localeCompare(b.started_on ?? b.finished_on ?? '9'));
  const works = jobs.filter(j => j.description).map(j => {
    const s = dateUa(j.started_on), e = dateUa(j.finished_on);
    const days = j.started_on && j.finished_on ? Math.max(1, daysBetween(j.started_on, j.finished_on)) : null;
    return { title: cap(j.description!.trim()), period: s && e ? (s === e ? s : `${s} – ${e}`) : (s ?? e), days, done: j.status === 'Завершено' };
  });
  const jobsDone = works.filter(w => w.done).length;
  const parts = input.parts.map(p => ({ name: cap(p.name.trim()), qty: p.qty, installed: p.status === 'Встановлено' }));
  const partsInstalledRows = input.parts.filter(p => p.status === 'Встановлено');
  const partsInstalled = partsInstalledRows.reduce((a, p) => a + (Number.isFinite(p.qty) ? p.qty : 0), 0);

  // ----- гроші: лише витрати цього авто -----
  const fin = input.finance.filter(f => f.scope === 'vehicle' && f.vehicle_id === v.id && f.amount > 0);
  const cents = (n: number) => Math.round(n * 100);
  const totalC = fin.reduce((a, f) => a + cents(f.amount), 0);
  const paidC = fin.filter(f => f.pay_status === 'Оплачено').reduce((a, f) => a + cents(f.amount), 0);
  const byCat = new Map<string, { c: number; inferred: boolean }>();
  for (const f of fin) {
    const { category, inferred } = categoryOf(f, partNames);
    const cur = byCat.get(category) ?? { c: 0, inferred: false };
    byCat.set(category, { c: cur.c + cents(f.amount), inferred: cur.inferred || inferred });
  }
  const spend: SpendRow[] = [...byCat].map(([category, x]) => ({ category, amount: x.c / 100, share: totalC ? x.c / totalC : 0, inferred: x.inferred }))
    .sort((a, b) => b.amount - a.amount || a.category.localeCompare(b.category));
  const bySrc = new Map<string, number>();
  for (const f of fin) bySrc.set(f.source || 'Не вказано', (bySrc.get(f.source || 'Не вказано') ?? 0) + cents(f.amount));
  const sources = [...bySrc].map(([source, c]) => ({ source, amount: c / 100 })).sort((a, b) => b.amount - a.amount);
  const labels = r?.row_labels ?? {};
  const invoiceRows: InvoiceRow[] = [...fin].sort((a, b) => (a.spent_on ?? '9').localeCompare(b.spent_on ?? '9')).map(f => ({
    id: f.id, date: dateUa(f.spent_on), amount: f.amount, paid: f.pay_status === 'Оплачено',
    category: categoryOf(f, partNames).category,
    label: (labels[String(f.id)] ?? '').trim() || (f.purpose ?? '').trim() || categoryOf(f, partNames).category,
  }));

  // ----- дати й тривалість -----
  const lastFinished = maxIso(input.jobs.map(j => j.finished_on));
  const firstStarted = minIso(input.jobs.map(j => j.started_on));
  const end = v.handed_over_on ?? lastFinished ?? (final.includes(v.status) ? isoOf(now) : null);
  const days = v.received_on && end ? Math.max(1, daysBetween(v.received_on, end)) : null;
  const showUnit = r ? r.show_unit : true;
  const unitName = ((r?.unit_label ?? '').trim() || (v.military_unit ?? '').trim()) || null;
  const unit = showUnit ? unitName : null;
  const timeline: { date: string; label: string; iso: string }[] = [];
  if (v.received_on) timeline.push({ iso: v.received_on, date: dateUa(v.received_on)!, label: 'Авто прибуло на СТО' });
  if (firstStarted) timeline.push({ iso: firstStarted, date: dateUa(firstStarted)!, label: 'Почали ремонт' });
  if (lastFinished && final.includes(v.status)) timeline.push({ iso: lastFinished, date: dateUa(lastFinished)!, label: 'Ремонт завершено' });
  if (v.handed_over_on) timeline.push({ iso: v.handed_over_on, date: dateUa(v.handed_over_on)!, label: unit ? `Передано: ${unit}` : 'Передано військовим' });
  timeline.sort((a, b) => a.iso.localeCompare(b.iso));

  // ----- історія -----
  const own = (r?.story ?? '').trim();
  let paragraphs: string[];
  if (own) paragraphs = own.split(/\n\s*\n/).map(p => p.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
  else {
    paragraphs = [];
    // типи з довідника (позашляховик, мікроавтобус, пікап, вантажівка) — чоловічого роду; інакше «авто» (сер. рід)
    const typed = !!v.vehicle_type && v.vehicle_type !== 'Інше';
    const subject = typed ? `${cap(v.vehicle_type!.trim())} «${v.name}»` : `Авто «${v.name}»`;
    const p1: string[] = [];
    p1.push(v.received_on ? `${subject} ${typed ? 'прибув' : 'прибуло'} на СТО «База» ${dateUa(v.received_on)}.` : `${subject} ${typed ? 'потрапив' : 'потрапило'} на СТО «База».`);
    if (v.purpose?.trim()) p1.push(`Завдання машини в підрозділі — ${low(v.purpose.trim().replace(/\.$/, ''))}.`);
    paragraphs.push(p1.join(' '));
    const p2: string[] = [];
    if (jobsDone) {
      const names = works.filter(w => w.done).map(w => low(w.title));
      const shown = names.slice(0, 4);
      const rest = names.length - shown.length;
      p2.push(`${days ? `За ${days} ${plural(days, ['день', 'дні', 'днів'])} на СТО` : 'Під час ремонту'} виконано ${jobsDone} ${plural(jobsDone, ['роботу', 'роботи', 'робіт'])}: ${rest > 0 ? `${shown.join(', ')} та ще ${rest}` : list(shown)}.`);
    }
    if (partsInstalled) p2.push(`Встановлено ${partsInstalled} ${plural(partsInstalled, ['запчастину', 'запчастини', 'запчастин'])} ${partsInstalledRows.length > 1 ? `(${partsInstalledRows.length} ${plural(partsInstalledRows.length, ['позиція', 'позиції', 'позицій'])})` : ''}`.trim() + '.');
    if (p2.length) paragraphs.push(p2.join(' '));
    const p3: string[] = [];
    if (totalC) {
      p3.push(`Загальна вартість — ${money(totalC / 100)}.`);
      if (totalC - paidC > 0) p3.push(`З них ${money((totalC - paidC) / 100)} ще в процесі оплати.`);
    }
    if (v.handed_over_on) p3.push(unit ? `${dateUa(v.handed_over_on)} машину передали: ${unit}.` : `${dateUa(v.handed_over_on)} машину передали військовим.`);
    else if (final.includes(v.status)) p3.push(unit ? `Машина готова до передачі: ${unit}.` : 'Машина готова й чекає на передачу.');
    if (p3.length) paragraphs.push(p3.join(' '));
  }

  // ----- попередження для керівника -----
  const warnings: string[] = [];
  if (!own) warnings.push('Історію складено автоматично з даних. Допишіть своїми словами, чим ця машина особлива: так звіт читається значно краще.');
  if (!fin.length) warnings.push('По авто немає жодної витрати: розділ «Кошти» буде порожнім.');
  const missing = REQUIRED_LOGISTICS.filter(c => !byCat.has(c));
  if (fin.length && missing.length) warnings.push(`Немає витрат: ${list(missing.map(low))}. Їх треба взяти в бухгалтерії та в Андрія: вони мають бути у звіті.`);
  if (totalC - paidC > 0) warnings.push(`Ще не оплачено ${money((totalC - paidC) / 100)}: у звіті ці рядки будуть позначені «в процесі оплати».`);
  const inferredN = fin.filter(f => !f.category).length;
  if (inferredN) warnings.push(`Статтю ${inferredN} ${plural(inferredN, ['витрати', 'витрат', 'витрат'])} визначено за описом. Перевірте у списку нижче.`);
  if (input.sharedUnallocated) warnings.push(`Є ${input.sharedUnallocated} ${plural(input.sharedUnallocated, ['спільний платіж', 'спільні платежі', 'спільних платежів'])} на кілька авто: у звіт вони не потрапляють, поки їх не розподілено.`);
  const showInvoices = r ? r.show_invoices : true;
  if (showInvoices) for (const i of invoiceRows) if (looksPrivate(i.label)) warnings.push(`Підпис рахунку «${i.label}» схожий на назву компанії, ім'я чи контакт. Перепишіть його для донорів.`);
  if (showUnit && !unitName) warnings.push('Не вказано підрозділ. У звіті буде «передано військовим».');
  if (!own && v.purpose?.trim()) warnings.push('В історію потрапило призначення машини. Перевірте, щоб там не було напрямку чи місця служби.');
  if (v.status === 'Передано частині' && !v.handed_over_on) warnings.push('Не вказано дату передачі.');
  if (!(input.images?.length)) warnings.push('Немає фото. Додайте «до» і «після»: зі світлинами звіт значно сильніший.');

  return {
    draft: !input.final,
    reportNo: v.id,
    generatedOn: dateUa(isoOf(now))!,
    vehicle: { id: v.id, name: v.name, type: v.vehicle_type, purpose: v.purpose?.trim() || null },
    status: v.status,
    unit,
    handedOverOn: dateUa(v.handed_over_on),
    figures: { total: totalC / 100, paid: paidC / 100, pending: (totalC - paidC) / 100, days, jobsDone, partsInstalled, partItems: partsInstalledRows.length },
    story: { paragraphs, auto: !own },
    timeline: timeline.map(({ date, label }) => ({ date, label })),
    works,
    parts,
    spend,
    sources,
    invoices: showInvoices ? invoiceRows : null,
    images: input.images ?? [],
    thanks: (r?.thanks ?? '').trim() || BRAND.defaultThanks,
    about: BRAND.about,
    warnings,
  };
}
