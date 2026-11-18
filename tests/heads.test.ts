// Керівники «Бази» (base_heads): рішення Олега 18.11.2026 — керівник лише він (за потреби ще Андрій),
// навіть якщо в «Штабі» є інші керівники.
import { describe, it, expect, beforeAll } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { freshDb, seed } from './helpers';

const OLEG = '00000000-0000-0000-0000-0000000000a1';      // керівник «Штабу» і «Бази»
const OTHER_HEAD = '00000000-0000-0000-0000-0000000000a2'; // керівник «Штабу», але не «Бази»
const ANDRIY = '00000000-0000-0000-0000-0000000000a3';     // у «Штабі» — член команди, у «Базі» — керівник
const MEMBER = '00000000-0000-0000-0000-0000000000b2';

let db: PGlite;
async function as(uid: string | 'owner') {
  await db.exec('reset role');
  if (uid === 'owner') return;
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
  await db.exec('set role authenticated');
}
const q = async (sql: string) => (await db.query<any>(sql)).rows;
const isHead = async (uid: string) => { await as(uid); return (await q('select base_is_head() as h'))[0].h as boolean; };
const canChangeStatus = async (uid: string) => {
  await as(uid);
  await db.exec(`update base_vehicles set status = 'Діагностика' where id = 'АВТО-001'`);
  await as('owner');
  const changed = (await q(`select status from base_vehicles where id = 'АВТО-001'`))[0].status === 'Діагностика';
  await db.exec(`update base_vehicles set status = 'В ремонті' where id = 'АВТО-001'`);
  return changed;
};
const seesFinance = async (uid: string) => { await as(uid); return (await q('select id from base_finance')).length > 0; };

beforeAll(async () => {
  db = await freshDb();
  await seed(db);
  await db.exec(`
    insert into stub_members values ('${OLEG}', true), ('${OTHER_HEAD}', true), ('${ANDRIY}', false), ('${MEMBER}', false);
    insert into base_finance (scope, vehicle_id, amount, pay_status) values ('vehicle', 'АВТО-001', 500, 'Очікує оплати');
  `);
});

describe('керівники «Бази»', () => {
  it('список порожній — як раніше: керівники «Штабу» керують «Базою», члени команди — ні', async () => {
    expect(await isHead(OLEG)).toBe(true);
    expect(await isHead(OTHER_HEAD)).toBe(true);
    expect(await isHead(ANDRIY)).toBe(false);
    expect(await canChangeStatus(OTHER_HEAD)).toBe(true);
  });
  it('список заповнено (Олег, Андрій): інший керівник «Штабу» більше не змінює статуси й не бачить фінансів', async () => {
    await as('owner');
    await db.exec(`insert into base_heads (user_id, note) values ('${OLEG}', 'Олег — координатор'), ('${ANDRIY}', 'Андрій')`);
    expect(await isHead(OLEG)).toBe(true);
    expect(await isHead(ANDRIY)).toBe(true);     // у «Штабі» не керівник, але в «Базі» — так
    expect(await isHead(OTHER_HEAD)).toBe(false);
    expect(await isHead(MEMBER)).toBe(false);
    expect(await canChangeStatus(OLEG)).toBe(true);
    expect(await canChangeStatus(ANDRIY)).toBe(true);
    expect(await canChangeStatus(OTHER_HEAD)).toBe(false);
    expect(await seesFinance(OLEG)).toBe(true);
    expect(await seesFinance(OTHER_HEAD)).toBe(false);
    await as(OTHER_HEAD);
    expect((await q('select id from base_vehicles')).length).toBe(3); // читати авто, як і вся команда, може
  });
  it('людина, яку прибрали з команди «Штабу», втрачає права в «Базі», навіть якщо лишилась у списку', async () => {
    await as('owner');
    await db.exec(`delete from stub_members where user_id = '${ANDRIY}'`);
    expect(await isHead(ANDRIY)).toBe(false);
    await as('owner');
    await db.exec(`insert into stub_members values ('${ANDRIY}', false)`);
  });
  it('список не видно й не змінити із застосунку — навіть керівнику «Бази»', async () => {
    await as(OLEG);
    await expect(db.query('select * from base_heads')).rejects.toThrow(/permission denied/);
    await expect(db.exec(`insert into base_heads (user_id) values ('${OTHER_HEAD}')`)).rejects.toThrow(/permission denied/);
    await expect(db.exec(`delete from base_heads`)).rejects.toThrow(/permission denied/);
  });
});
