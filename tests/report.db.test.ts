import { describe, it, expect, beforeAll } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { freshDb, seed } from './helpers';

const HEAD = '00000000-0000-0000-0000-0000000000a1';
const MEMBER = '00000000-0000-0000-0000-0000000000b2';
let db: PGlite;
async function as(who: 'head' | 'member' | 'owner') {
  await db.exec('reset role');
  if (who === 'owner') return;
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [who === 'head' ? HEAD : MEMBER]);
  await db.exec('set role authenticated');
}
const q = async (sql: string) => (await db.query<any>(sql)).rows;
const fails = async (sql: string) => { try { await db.exec(sql); return false; } catch { return true; } };

beforeAll(async () => {
  db = await freshDb();
  await seed(db);
  await db.exec(`insert into stub_members values ('${HEAD}', true), ('${MEMBER}', false);`);
});

describe('звіт для донорів: база', () => {
  it('авто, додане одразу «Готовим», і авто, що стало «Готовим», отримують чернетку звіту', async () => {
    await as('owner');
    // seed вставив АВТО-003 зі статусом «Готовий» — тригер на INSERT теж спрацьовує
    expect((await q(`select vehicle_id from base_donor_reports`)).map(r => r.vehicle_id)).toEqual(['АВТО-003']);
    await as('head');
    await db.exec(`update base_vehicles set status='Готовий' where id='АВТО-001'`);
    const r = await q(`select vehicle_id, status, show_unit, show_invoices from base_donor_reports where vehicle_id='АВТО-001'`);
    expect(r).toEqual([{ vehicle_id: 'АВТО-001', status: 'Чернетка', show_unit: true, show_invoices: true }]);
  });
  it('повторна зміна статусу не дублює і не скидає звіт', async () => {
    await as('head');
    await db.exec(`update base_donor_reports set story='Своя історія' where vehicle_id='АВТО-001'`);
    await db.exec(`update base_vehicles set status='Передано частині' where id='АВТО-001'`);
    expect(await q(`select story from base_donor_reports where vehicle_id='АВТО-001'`)).toEqual([{ story: 'Своя історія' }]);
  });
  it('статус не фінальний — чернетка не створюється', async () => {
    await as('head');
    await db.exec(`update base_vehicles set status='Діагностика' where id='АВТО-002'`);
    expect(await q(`select 1 from base_donor_reports where vehicle_id='АВТО-002'`)).toEqual([]);
  });
  it('член команди не бачить звітів і не створює їх; керівник бачить список «чекають звіту»', async () => {
    await as('member');
    expect(await q('select * from base_donor_reports')).toEqual([]);
    expect(await q('select * from base_reports_pending')).toEqual([]);
    expect(await fails(`insert into base_donor_reports (vehicle_id) values ('АВТО-002')`)).toBe(true);
    await as('head');
    expect((await q('select vehicle_id from base_reports_pending order by vehicle_id')).map(r => r.vehicle_id)).toEqual(['АВТО-001', 'АВТО-003']);
  });
  it('категорія витрати лише з довідника', async () => {
    await as('head');
    await db.exec(`insert into base_finance (scope, vehicle_id, amount, category) values ('vehicle','АВТО-001', 100, 'Пальне')`);
    expect(await fails(`insert into base_finance (scope, vehicle_id, amount, category) values ('vehicle','АВТО-001', 100, 'Шаурма')`)).toBe(true);
  });
  it('сформований звіт зникає зі списку «чекають»', async () => {
    await as('head');
    await db.exec(`update base_donor_reports set status='Сформовано', storage_path='finance/reports/АВТО-003/zvit.pdf' where vehicle_id='АВТО-003'`);
    expect((await q('select vehicle_id from base_reports_pending')).map(r => r.vehicle_id)).toEqual(['АВТО-001']);
  });
});
