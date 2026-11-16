// Розбір xlsx «STO_BAZA_Oblik» у типізовані рядки. Читаємо лише колонки введення
// за назвами заголовків; формульні колонки (Назва_авто, Тривалість, «Всього ще винні»)
// ігноруємо. Усе дивне потрапляє в warnings, нічого не губиться мовчки.
import ExcelJS from 'exceljs';

export interface Warn { sheet: string; row?: number; message: string }
export interface LegacyLink { field: string; url: string; text?: string }

export interface VehicleRow { id: string; name: string; vehicle_type: string|null; vin: string|null; plate: string|null;
  status: string; requested_by: string|null; military_unit: string|null; purpose: string|null;
  received_on: string|null; handed_over_on: string|null; notes: string|null; legacy_links: LegacyLink[]|null; _row: number }
export interface NomRow { id: string; kind: 'work'|'part'|'expense'|'doc'; name: string; category: string|null;
  aliases: string|null; planned_days: number|null; delay_risk: string|null; _row: number }
export interface ModelRow { id: string; model: string; vehicle_type: string|null; engine_fuel: string|null;
  service_interval: string|null; weak_points: string|null; parts_availability: string|null;
  intake_checklist: string|null; data_status: string|null; _row: number }
export interface JobRow { vehicle_id: string; nomenclature_id: string|null; description: string|null; executor: string|null;
  location: string|null; status: string; started_on: string|null; finished_on: string|null; notes: string|null; _row: number }
export interface PartRow { vehicle_id: string; nomenclature_id: string|null; name: string; qty: number; status: string;
  supplier: string|null; cost_total: number|null; ordered_on: string|null; received_on: string|null; notes: string|null; _row: number }
export interface FinRow { scope: 'vehicle'|'unassigned'; vehicle_id: string|null; amount: number; spent_on: string|null; purpose: string|null; doc_ref: string|null;
  source: string|null; person_dejure: string|null; contact: string|null; pay_status: string; paid_on: string|null;
  paid_to_dejure: string|null; paid_to_defacto: string|null; legacy_links: LegacyLink[]|null; notes: string|null; _row: number }
export interface DocRow { vehicle_id: string; doc_type_name: string|null; doc_date: string|null; uploaded_by_label: string|null;
  legacy_links: LegacyLink[]|null; notes: string|null; _row: number }

export interface Parsed {
  vehicles: VehicleRow[]; nomenclature: NomRow[]; models: ModelRow[];
  jobs: JobRow[]; parts: PartRow[]; finance: FinRow[]; documents: DocRow[]; warnings: Warn[];
}

type Cell = ExcelJS.CellValue;

function isObj(v: unknown): v is Record<string, any> { return v !== null && typeof v === 'object' && !(v instanceof Date); }

export function cellText(v: Cell): string | null {
  if (v === null || v === undefined) return null;
  let t: string;
  if (v instanceof Date) t = v.toISOString().slice(0, 10);
  else if (isObj(v)) {
    if ('richText' in v) t = (v.richText as any[]).map(r => r.text).join('');
    else if ('text' in v) t = typeof v.text === 'string' ? v.text : String((v.text as any)?.richText?.map((r: any) => r.text).join('') ?? '');
    else if ('result' in v) return cellText(v.result as Cell);
    else if ('error' in v) return null;
    else t = JSON.stringify(v);
  } else t = String(v);
  t = t.replace(/ /g, ' ').trim();
  return t === '' ? null : t;
}

export function cellLink(v: Cell): LegacyLink | null {
  if (!isObj(v)) return null;
  const h = (v as Record<string, any>).hyperlink;
  const url = typeof h === 'string' ? h : null;
  if (url) return { field: '', url, text: cellText(v) ?? undefined };
  return null;
}

function parseDate(v: Cell, w: (m: string) => void, what: string): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const t = cellText(v);
  if (!t) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[.\/](\d{1,2})[.\/](\d{2,4})$/.exec(t);
  if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  w(`${what}: не вдалося розпізнати дату «${t}»`);
  return null;
}

function parseNum(v: Cell, w: (m: string) => void, what: string): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v;
  const t = cellText(v);
  if (!t) return null;
  const cleaned = t.replace(/[\s ]/g, '').replace(/грн|₴|uah/gi, '').replace(',', '.');
  const n = Number(cleaned);
  if (Number.isNaN(n)) { w(`${what}: не вдалося розпізнати число «${t}»`); return null; }
  return n;
}

function headerMap(ws: ExcelJS.Worksheet, headerRow: number): { cols: Record<string, number>; last: number } {
  const cols: Record<string, number> = {}; let last = 0;
  ws.getRow(headerRow).eachCell({ includeEmpty: false }, (c, n) => {
    const t = cellText(c.value); if (t) { cols[t.replace(/\s+/g, ' ')] = n; last = Math.max(last, n); }
  });
  return { cols, last };
}

const val = (ws: ExcelJS.Worksheet, r: number, c: number | undefined): Cell => (c ? ws.getRow(r).getCell(c).value : null);

export async function parseWorkbook(path: string): Promise<Parsed> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const out: Parsed = { vehicles: [], nomenclature: [], models: [], jobs: [], parts: [], finance: [], documents: [], warnings: [] };
  const warn = (sheet: string, row: number | undefined, message: string) => out.warnings.push({ sheet, row, message });

  const sheet = (name: string, required: string[]) => {
    const ws = wb.getWorksheet(name);
    if (!ws) { warn(name, undefined, 'Аркуш не знайдено, пропущено'); return null; }
    const hm = headerMap(ws, 1);
    const miss = required.filter(h => !(h in hm.cols));
    if (miss.length) { warn(name, 1, `Немає потрібних заголовків: ${miss.join(', ')}. Аркуш пропущено`); return null; }
    return { ws, ...hm };
  };
  const stray = (name: string, ws: ExcelJS.Worksheet, r: number, last: number) => {
    ws.getRow(r).eachCell({ includeEmpty: false }, (c, n) => {
      if (n > last) { const t = cellText(c.value); if (t) warn(name, r, `Дані поза таблицею (стовпець ${n}) НЕ імпортовано: «${t.slice(0, 80)}»`); }
    });
  };
  const links = (cells: [string, Cell][]): LegacyLink[] | null => {
    const res: LegacyLink[] = [];
    for (const [field, v] of cells) {
      const l = cellLink(v);
      if (l) res.push({ ...l, field });
      else { const t = cellText(v); if (t && /^https?:\/\//i.test(t)) res.push({ field, url: t }); }
    }
    return res.length ? res : null;
  };

  // ---- Автомобілі
  let s = sheet('Автомобілі', ['ID_авто', 'Назва_марка_модель', 'Статус']);
  if (s) {
    const { ws, cols: c, last } = s;
    for (let r = 2; r <= ws.rowCount; r++) {
      const w = (m: string) => warn('Автомобілі', r, m);
      const id = cellText(val(ws, r, c['ID_авто']));
      if (!id) { stray('Автомобілі', ws, r, last); continue; }
      out.vehicles.push({
        id, name: cellText(val(ws, r, c['Назва_марка_модель'])) ?? id,
        vehicle_type: cellText(val(ws, r, c['Тип'])), vin: cellText(val(ws, r, c['VIN'])), plate: cellText(val(ws, r, c['Держ_номер'])),
        status: cellText(val(ws, r, c['Статус'])) ?? 'Прийнято',
        requested_by: cellText(val(ws, r, c['Хто_надіслав_запит'])), military_unit: cellText(val(ws, r, c['Військова_частина'])),
        purpose: cellText(val(ws, r, c['Призначення'])),
        received_on: parseDate(val(ws, r, c['Дата_прийому']), w, 'Дата_прийому'),
        handed_over_on: parseDate(val(ws, r, c['Дата_передачі']), w, 'Дата_передачі'),
        notes: cellText(val(ws, r, c['Примітки'])),
        legacy_links: links([['photo', val(ws, r, c['Посилання_на_фото'])]]), _row: r,
      });
      stray('Автомобілі', ws, r, last);
    }
  }

  // ---- Ремонтні_роботи (ID_роботи = ID номенклатури, повторюється)
  s = sheet('Ремонтні_роботи', ['ID_авто', 'Статус']);
  if (s) {
    const { ws, cols: c, last } = s;
    for (let r = 2; r <= ws.rowCount; r++) {
      const w = (m: string) => warn('Ремонтні_роботи', r, m);
      const vid = cellText(val(ws, r, c['ID_авто']));
      if (!vid) { stray('Ремонтні_роботи', ws, r, last); continue; }
      out.jobs.push({
        vehicle_id: vid, nomenclature_id: cellText(val(ws, r, c['ID_роботи'])),
        description: cellText(val(ws, r, c['Опис_роботи'])), executor: cellText(val(ws, r, c['Виконавець'])),
        location: cellText(val(ws, r, c['Місце знаходження'])), status: cellText(val(ws, r, c['Статус'])) ?? 'Заплановано',
        started_on: parseDate(val(ws, r, c['Дата_початку']), w, 'Дата_початку'),
        finished_on: parseDate(val(ws, r, c['Дата_закінчення']), w, 'Дата_закінчення'),
        notes: cellText(val(ws, r, c['Примітки'])), _row: r,
      });
      stray('Ремонтні_роботи', ws, r, last);
    }
  }

  // ---- Запчастини
  s = sheet('Запчастини', ['ID_авто', 'Назва_запчастини']);
  if (s) {
    const { ws, cols: c, last } = s;
    for (let r = 2; r <= ws.rowCount; r++) {
      const w = (m: string) => warn('Запчастини', r, m);
      const vid = cellText(val(ws, r, c['ID_авто']));
      if (!vid) { stray('Запчастини', ws, r, last); continue; }
      out.parts.push({
        vehicle_id: vid, nomenclature_id: cellText(val(ws, r, c['ID_запчастини'])),
        name: cellText(val(ws, r, c['Назва_запчастини'])) ?? '(без назви)',
        qty: parseNum(val(ws, r, c['Кількість']), w, 'Кількість') ?? 1,
        status: cellText(val(ws, r, c['Статус'])) ?? 'Замовлено', supplier: cellText(val(ws, r, c['Постачальник'])),
        cost_total: parseNum(val(ws, r, c['Вартість_грн']), w, 'Вартість_грн'),
        ordered_on: parseDate(val(ws, r, c['Дата_замовлення']), w, 'Дата_замовлення'),
        received_on: parseDate(val(ws, r, c['Дата_отримання']), w, 'Дата_отримання'),
        notes: cellText(val(ws, r, c['Примітки'])), _row: r,
      });
      stray('Запчастини', ws, r, last);
    }
  }

  // ---- Фінанси
  s = sheet('Фінанси', ['ID_авто', 'Сума_грн', 'Статус_оплати']);
  if (s) {
    const { ws, cols: c, last } = s;
    for (let r = 2; r <= ws.rowCount; r++) {
      const w = (m: string) => warn('Фінанси', r, m);
      const vid = cellText(val(ws, r, c['ID_авто']));
      const amount = parseNum(val(ws, r, c['Сума_грн']), w, 'Сума_грн');
      if (!vid && amount === null) { stray('Фінанси', ws, r, last); continue; }
      if (amount === null) { w('Рядок пропущено: немає суми'); continue; }
      if (!vid) w(`Немає ID_авто: імпортовано як «не віднесено» (сума ${amount}), потребує віднесення вручну`);
      const F = val(ws, r, c['На_що_витрачено']), G = val(ws, r, c['Документ']), Q = val(ws, r, c['Рахунок / акт (посилання)']);
      out.finance.push({
        scope: vid ? 'vehicle' : 'unassigned', vehicle_id: vid, amount, spent_on: parseDate(val(ws, r, c['Дата']), w, 'Дата'),
        purpose: cellText(F), doc_ref: cellText(G), source: cellText(val(ws, r, c['Джерело_коштів'])),
        person_dejure: cellText(val(ws, r, c['ПІБ_особи ДеЮрЕ'])), contact: cellText(val(ws, r, c['Контакт_особи відповідальної'])),
        pay_status: cellText(val(ws, r, c['Статус_оплати'])) ?? 'Очікує оплати',
        paid_on: parseDate(val(ws, r, c['Дата_оплати']), w, 'Дата_оплати'),
        paid_to_dejure: cellText(val(ws, r, c['Кому сплачено (де-юре)'])), paid_to_defacto: cellText(val(ws, r, c['Кому сплачено (де-факто)'])),
        legacy_links: links([['purpose', F], ['doc', G], ['invoice', Q]]),
        notes: cellText(val(ws, r, c['Примітки'])), _row: r,
      });
      stray('Фінанси', ws, r, last);
    }
  }

  // ---- Документи
  s = sheet('Документи', ['ID_авто', 'Тип_документа']);
  if (s) {
    const { ws, cols: c, last } = s;
    for (let r = 2; r <= ws.rowCount; r++) {
      const w = (m: string) => warn('Документи', r, m);
      const vid = cellText(val(ws, r, c['ID_авто']));
      if (!vid) { stray('Документи', ws, r, last); continue; }
      out.documents.push({
        vehicle_id: vid, doc_type_name: cellText(val(ws, r, c['Тип_документа'])),
        doc_date: parseDate(val(ws, r, c['Дата']), w, 'Дата'), uploaded_by_label: cellText(val(ws, r, c['Хто_завантажив'])),
        legacy_links: links([['file', val(ws, r, c['Посилання_на_файл'])]]), notes: cellText(val(ws, r, c['Примітки'])), _row: r,
      });
    }
  }

  // ---- Номенклатура (чотири блоки; вид визначаємо за префіксом ID)
  const nws = wb.getWorksheet('Номенклатура');
  if (nws) {
    const kinds: Record<string, NomRow['kind']> = { 'РОБ': 'work', 'ЗЧ': 'part', 'ВИТ': 'expense', 'ДОК': 'doc' };
    for (let r = 1; r <= nws.rowCount; r++) {
      const id = cellText(val(nws, r, 1));
      const m = id ? /^(РОБ|ЗЧ|ВИТ|ДОК)-\d+$/.exec(id) : null;
      if (!id || !m) continue;
      const kind = kinds[m[1]];
      const w = (msg: string) => warn('Номенклатура', r, msg);
      out.nomenclature.push({
        id, kind, name: cellText(val(nws, r, 2)) ?? id, category: cellText(val(nws, r, 3)), aliases: cellText(val(nws, r, 4)),
        planned_days: kind === 'work' ? parseNum(val(nws, r, 5), w, 'Час прогнозований') : null,
        delay_risk: kind === 'work' ? cellText(val(nws, r, 6)) : null, _row: r,
      });
    }
  } else warn('Номенклатура', undefined, 'Аркуш не знайдено, пропущено');

  // ---- Довідник моделей (таблиця після рядка «ID_моделі»)
  const dws = wb.getWorksheet('Довідник_авто');
  if (dws) {
    for (let r = 1; r <= dws.rowCount; r++) {
      const id = cellText(val(dws, r, 1));
      if (!id || !/^МОД-\d+$/.test(id)) continue;
      out.models.push({
        id, model: cellText(val(dws, r, 2)) ?? id, vehicle_type: cellText(val(dws, r, 3)), engine_fuel: cellText(val(dws, r, 4)),
        service_interval: cellText(val(dws, r, 5)), weak_points: cellText(val(dws, r, 6)), parts_availability: cellText(val(dws, r, 7)),
        intake_checklist: cellText(val(dws, r, 8)), data_status: cellText(val(dws, r, 9)), _row: r,
      });
    }
  } else warn('Довідник_авто', undefined, 'Аркуш не знайдено, пропущено');

  return out;
}
