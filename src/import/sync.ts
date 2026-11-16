// Узгодження розібраного xlsx з базою. Принципи:
//  • за замовчуванням лише план (dry-run), нічого не пишеться;
//  • apply додає ЛИШЕ нові рядки; існуючі ніколи не перезаписуються;
//  • відмінності в існуючих рядках показуються як розбіжності (conflicts);
//  • рядки, що порушують довідники/обмеження, відхиляються з причиною, не валять усе.
import { createHash } from 'node:crypto';
import type { Parsed, Warn } from './parse';

export interface Db { query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[] }> }

export interface Conflict { table: string; id: string; diffs: { field: string; db: unknown; file: unknown }[] }
export interface Rejected { table: string; row: number; reason: string }
export interface Orphan { table: string; import_key: string; label: string }

export interface Plan {
  inserts: Record<string, Record<string, unknown>[]>;
  unchanged: Record<string, number>;
  conflicts: Conflict[];
  rejected: Rejected[];
  orphans: Orphan[];
  warnings: Warn[];
}

const TABLES = ['base_vehicles', 'base_nomenclature', 'base_ref_models', 'base_jobs', 'base_parts', 'base_finance', 'base_documents'] as const;

const norm = (v: unknown): unknown => {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string') { const t = v.trim(); return t === '' ? null : t; }
  if (typeof v === 'number') return Math.round(v * 1e6) / 1e6;
  return v;
};
const sameVal = (a: unknown, b: unknown) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));
const hash = (...parts: unknown[]) =>
  createHash('sha1').update(parts.map(p => String(norm(p) ?? '')).join('␟')).digest('hex').slice(0, 20);

function withOccurrence(base: string, seen: Map<string, number>): string {
  const n = (seen.get(base) ?? 0) + 1; seen.set(base, n);
  return `${base}#${n}`;
}

export async function planSync(db: Db, p: Parsed): Promise<Plan> {
  const plan: Plan = {
    inserts: Object.fromEntries(TABLES.map(t => [t, []])) as Plan['inserts'],
    unchanged: Object.fromEntries(TABLES.map(t => [t, 0])),
    conflicts: [], rejected: [], orphans: [], warnings: [...p.warnings],
  };
  const reject = (table: string, row: number, reason: string) => plan.rejected.push({ table, row, reason });

  // довідники значень
  const refs = new Map<string, Set<string>>();
  for (const r of (await db.query<{ kind: string; value: string }>('select kind, value from base_ref_values')).rows) {
    if (!refs.has(r.kind)) refs.set(r.kind, new Set());
    refs.get(r.kind)!.add(r.value);
  }
  const okRef = (kind: string, v: string | null | undefined) => v == null || (refs.get(kind)?.has(v) ?? false);
  const refMsg = (field: string, kind: string, v: string | null) =>
    `${field}: значення «${v}» немає в довіднику ${kind} (${[...(refs.get(kind) ?? [])].join(', ')})`;

  const loadById = async (table: string, idCol = 'id') =>
    new Map((await db.query<{ j: any }>(`select to_jsonb(t) as j from ${table} t`)).rows.map(r => [String(r.j[idCol]), r.j]));

  const compare = (table: string, id: string, existing: any, row: Record<string, unknown>, fields: string[]) => {
    const diffs = fields.filter(f => !sameVal(existing[f], row[f])).map(f => ({ field: f, db: existing[f] ?? null, file: row[f] ?? null }));
    if (diffs.length) plan.conflicts.push({ table, id, diffs }); else plan.unchanged[table]++;
  };

  // ---- Номенклатура
  const nomDb = await loadById('base_nomenclature');
  const nomIds = new Set(nomDb.keys());
  for (const n of p.nomenclature) {
    if (!okRef('delay_risk', n.delay_risk)) { reject('base_nomenclature', n._row, refMsg('delay_risk', 'delay_risk', n.delay_risk)); continue; }
    const row = { id: n.id, kind: n.kind, name: n.name, category: n.category, aliases: n.aliases, planned_days: n.planned_days, delay_risk: n.delay_risk };
    const ex = nomDb.get(n.id);
    if (ex) compare('base_nomenclature', n.id, ex, row, ['kind', 'name', 'category', 'aliases', 'planned_days', 'delay_risk']);
    else { plan.inserts.base_nomenclature.push(row); nomIds.add(n.id); }
  }
  const nameToDocId = new Map<string, string>();
  for (const n of [...nomDb.values(), ...p.nomenclature.map(x => ({ ...x }))]) if (n.kind === 'doc') nameToDocId.set(String(n.name).toLowerCase(), n.id);

  // ---- Моделі
  const modDb = await loadById('base_ref_models');
  for (const m of p.models) {
    const row = { id: m.id, model: m.model, vehicle_type: m.vehicle_type, engine_fuel: m.engine_fuel, service_interval: m.service_interval,
      weak_points: m.weak_points, parts_availability: m.parts_availability, intake_checklist: m.intake_checklist, data_status: m.data_status };
    const ex = modDb.get(m.id);
    if (ex) compare('base_ref_models', m.id, ex, row, Object.keys(row).filter(k => k !== 'id'));
    else plan.inserts.base_ref_models.push(row);
  }

  // ---- Автомобілі
  const vehDb = await loadById('base_vehicles');
  const vehIds = new Set(vehDb.keys());
  const seenVeh = new Set<string>();
  for (const v of p.vehicles) {
    if (seenVeh.has(v.id)) { reject('base_vehicles', v._row, `Дубль ID ${v.id} у файлі`); continue; }
    seenVeh.add(v.id);
    if (!/^АВТО-\d{3}$/.test(v.id)) { reject('base_vehicles', v._row, `ID «${v.id}» не відповідає формату АВТО-NNN`); continue; }
    if (!okRef('vehicle_status', v.status)) { reject('base_vehicles', v._row, refMsg('Статус', 'vehicle_status', v.status)); continue; }
    if (!okRef('vehicle_type', v.vehicle_type)) { reject('base_vehicles', v._row, refMsg('Тип', 'vehicle_type', v.vehicle_type)); continue; }
    if (v.received_on && v.handed_over_on && v.handed_over_on < v.received_on) { reject('base_vehicles', v._row, 'Дата передачі раніше за дату прийому'); continue; }
    const { _row, legacy_links, ...rest } = v;
    const row = { ...rest, legacy_links };
    const ex = vehDb.get(v.id);
    if (ex) compare('base_vehicles', v.id, ex, row, ['name', 'vehicle_type', 'vin', 'plate', 'status', 'requested_by', 'military_unit',
      'purpose', 'received_on', 'handed_over_on', 'notes']);
    else { plan.inserts.base_vehicles.push(row); vehIds.add(v.id); }
  }

  // ---- Рядки без природного ключа: відбиток + лічильник повторів
  const existingKeys = async (table: string) => new Map(
    (await db.query<{ import_key: string; j: any }>(`select import_key, to_jsonb(t) as j from ${table} t where import_key is not null`)).rows.map(r => [r.import_key, r.j]));
  const processKeyed = async (table: string, rows: { _row: number }[], build: (r: any, seen: Map<string, number>) => { key: string; row: Record<string, unknown>; label: string } | string) => {
    const ex = await existingKeys(table);
    const seen = new Map<string, number>(); const fileKeys = new Set<string>();
    for (const r of rows) {
      const b = build(r, seen);
      if (typeof b === 'string') { reject(table, r._row, b); continue; }
      fileKeys.add(b.key);
      if (ex.has(b.key)) plan.unchanged[table]++; else plan.inserts[table].push({ ...b.row, import_key: b.key });
    }
    for (const [k, j] of ex) if (!fileKeys.has(k)) plan.orphans.push({ table, import_key: k, label: `${j.vehicle_id ?? ''} ${j.description ?? j.name ?? j.purpose ?? ''}`.trim() });
  };
  const needVeh = (id: string) => vehIds.has(id) ? null : `Авто ${id} немає ні у файлі (прийнятому), ні в базі`;

  await processKeyed('base_jobs', p.jobs, (j: any, seen) => {
    const e = needVeh(j.vehicle_id); if (e) return e;
    if (!okRef('job_status', j.status)) return refMsg('Статус', 'job_status', j.status);
    if (j.started_on && j.finished_on && j.finished_on < j.started_on) return 'Дата закінчення раніше за початок';
    let nom = j.nomenclature_id;
    if (nom && !nomIds.has(nom)) { plan.warnings.push({ sheet: 'Ремонтні_роботи', row: j._row, message: `ID_роботи ${nom} немає в номенклатурі, збережено без зв'язку` }); nom = null; }
    const key = withOccurrence(hash('job', j.vehicle_id, j.nomenclature_id, j.description, j.started_on, j.executor), seen);
    const { _row, nomenclature_id, ...rest } = j;
    return { key, row: { ...rest, nomenclature_id: nom }, label: j.description ?? '' };
  });
  await processKeyed('base_parts', p.parts, (x: any, seen) => {
    const e = needVeh(x.vehicle_id); if (e) return e;
    if (!okRef('part_status', x.status)) return refMsg('Статус', 'part_status', x.status);
    if (!(x.qty > 0)) return 'Кількість має бути більшою за 0';
    if (x.cost_total != null && x.cost_total < 0) return 'Від’ємна вартість';
    if (x.ordered_on && x.received_on && x.received_on < x.ordered_on) return 'Дата отримання раніше за замовлення';
    let nom = x.nomenclature_id;
    if (nom && !nomIds.has(nom)) { plan.warnings.push({ sheet: 'Запчастини', row: x._row, message: `ID_запчастини ${nom} немає в номенклатурі, збережено без зв'язку` }); nom = null; }
    const key = withOccurrence(hash('part', x.vehicle_id, x.nomenclature_id, x.name, x.ordered_on, x.supplier, x.cost_total), seen);
    const { _row, nomenclature_id, ...rest } = x;
    return { key, row: { ...rest, nomenclature_id: nom }, label: x.name };
  });
  await processKeyed('base_finance', p.finance, (f: any, seen) => {
    if (f.vehicle_id) { const e = needVeh(f.vehicle_id); if (e) return e; }
    if (!(f.amount > 0)) return 'Сума має бути більшою за 0';
    if (!okRef('fund_source', f.source)) return refMsg('Джерело_коштів', 'fund_source', f.source);
    if (!okRef('pay_status', f.pay_status)) return refMsg('Статус_оплати', 'pay_status', f.pay_status);
    const key = withOccurrence(hash('fin', f.vehicle_id, f.amount, f.spent_on, f.person_dejure, f.source, f.doc_ref, f.paid_on), seen);
    const { _row, ...rest } = f;
    return { key, row: rest, label: f.purpose ?? f.doc_ref ?? '' };
  });
  await processKeyed('base_documents', p.documents, (d: any, seen) => {
    const e = needVeh(d.vehicle_id); if (e) return e;
    if (!d.legacy_links) return 'Немає посилання на файл';
    let typeId: string | null = null;
    if (d.doc_type_name) {
      typeId = nameToDocId.get(d.doc_type_name.toLowerCase()) ?? null;
      if (!typeId) plan.warnings.push({ sheet: 'Документи', row: d._row, message: `Тип документа «${d.doc_type_name}» немає в номенклатурі, тип не збережено` });
    }
    const key = withOccurrence(hash('doc', d.vehicle_id, d.doc_type_name, d.legacy_links?.[0]?.url, d.doc_date), seen);
    const { _row, doc_type_name, ...rest } = d;
    return { key, row: { ...rest, doc_type_id: typeId }, label: d.doc_type_name ?? '' };
  });

  return plan;
}

const JSON_COLS = new Set(['legacy_links']);

export async function applyPlan(db: Db, plan: Plan): Promise<Record<string, number>> {
  const done: Record<string, number> = {};
  await db.query('begin');
  try {
    // порядок важливий: батьківські таблиці перед дочірніми
    for (const t of TABLES) {
      for (const row of plan.inserts[t]) {
        const cols = Object.keys(row).filter(k => row[k] !== undefined);
        const ph = cols.map((c, i) => JSON_COLS.has(c) ? `$${i + 1}::jsonb` : `$${i + 1}`);
        const vals = cols.map(c => JSON_COLS.has(c) && row[c] != null ? JSON.stringify(row[c]) : row[c] ?? null);
        await db.query(`insert into ${t} (${cols.join(',')}) values (${ph.join(',')})`, vals);
      }
      done[t] = plan.inserts[t].length;
    }
    await db.query('commit');
  } catch (e) { await db.query('rollback'); throw e; }
  return done;
}

export function formatReport(plan: Plan, applied?: Record<string, number>): string {
  const L: string[] = [];
  L.push(applied ? '=== ІМПОРТ ВИКОНАНО ===' : '=== ПЛАН ІМПОРТУ (нічого не записано) ===');
  for (const t of TABLES) {
    const n = plan.inserts[t].length;
    L.push(`${t}: нових ${n}${applied ? ` (записано ${applied[t] ?? 0})` : ''}, без змін ${plan.unchanged[t]}`);
  }
  if (plan.conflicts.length) {
    L.push('', `РОЗБІЖНОСТІ з наявними даними (НЕ перезаписано): ${plan.conflicts.length}`);
    for (const c of plan.conflicts.slice(0, 50)) {
      L.push(`  ${c.table} ${c.id}`);
      for (const d of c.diffs) L.push(`    ${d.field}: у базі «${d.db ?? ''}» ≠ у файлі «${d.file ?? ''}»`);
    }
  }
  if (plan.rejected.length) {
    L.push('', `ВІДХИЛЕНО (не імпортуватиметься): ${plan.rejected.length}`);
    for (const r of plan.rejected) L.push(`  ${r.table}, рядок ${r.row}: ${r.reason}`);
  }
  if (plan.orphans.length) {
    L.push('', `Є В БАЗІ, але немає у файлі (можливо, рядок змінено у файлі; нічого не видалено): ${plan.orphans.length}`);
    for (const o of plan.orphans.slice(0, 50)) L.push(`  ${o.table}: ${o.label}`);
  }
  if (plan.warnings.length) {
    L.push('', `ПОПЕРЕДЖЕННЯ: ${plan.warnings.length}`);
    for (const w of plan.warnings) L.push(`  ${w.sheet}${w.row ? `, рядок ${w.row}` : ''}: ${w.message}`);
  }
  return L.join('\n');
}
