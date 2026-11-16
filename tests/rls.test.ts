import { describe, it, expect, beforeAll } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { freshDb, seed } from './helpers';

const HEAD = '00000000-0000-0000-0000-0000000000a1';
const MEMBER = '00000000-0000-0000-0000-0000000000b2';
const STRANGER = '00000000-0000-0000-0000-0000000000c3'; // авторизований, але не в команді

let db: PGlite;
async function as(who: 'head' | 'member' | 'stranger' | 'anon' | 'owner') {
  await db.exec('reset role');
  if (who === 'owner') return;
  const uid = { head: HEAD, member: MEMBER, stranger: STRANGER, anon: '' }[who];
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
  await db.exec(who === 'anon' ? 'set role anon' : 'set role authenticated');
}
const q = async (sql: string) => (await db.query<any>(sql)).rows;
const fails = async (sql: string) => { try { await db.exec(sql); return false; } catch { return true; } };

beforeAll(async () => {
  db = await freshDb();
  await seed(db);
  await db.exec(`
    insert into stub_members values ('${HEAD}', true), ('${MEMBER}', false);
    insert into base_jobs (vehicle_id, nomenclature_id, description, status) values ('АВТО-001','РОБ-001','Двигун','В процесі');
    insert into base_finance (scope, vehicle_id, amount, pay_status, person_dejure) values ('vehicle','АВТО-001', 1000, 'Очікує оплати', 'Особа А');
    insert into storage.objects (bucket_id, name) values ('base-files','vehicles/АВТО-001/a.jpg'), ('base-files','finance/rahunok.pdf');
    insert into base_audit_log (table_name, op) values ('base_finance','INSERT');
  `);
});

describe('RLS: член команди', () => {
  it('читає авто, роботи, довідники', async () => {
    await as('member');
    expect((await q('select id from base_vehicles')).length).toBe(3);
    expect((await q('select id from base_jobs')).length).toBe(1);
    expect((await q('select value from base_ref_values')).length).toBeGreaterThan(0);
  });
  it('НЕ бачить фінансів ні напряму, ні через view, ні журнал', async () => {
    await as('member');
    expect(await q('select * from base_finance')).toEqual([]);
    expect(await q('select * from base_pending_unattributed')).toEqual([]);
    expect(await q('select * from base_debts_by_person')).toEqual([]);
    expect(await q('select * from base_audit_log')).toEqual([]);
  });
  it('НЕ може писати: статус, роботи, фінанси, видаляти', async () => {
    await as('member');
    // update без прав не падає, а зачіпає 0 рядків — перевіряємо результат
    await db.exec(`update base_vehicles set status='Готовий' where id='АВТО-001'`);
    expect((await q(`select status from base_vehicles where id='АВТО-001'`))[0].status).toBe('В ремонті');
    expect(await fails(`insert into base_jobs (vehicle_id, description, status) values ('АВТО-001','x','Заплановано')`)).toBe(true);
    expect(await fails(`insert into base_finance (scope, vehicle_id, amount) values ('vehicle','АВТО-001',1)`)).toBe(true);
    await db.exec(`delete from base_vehicles where id='АВТО-002'`);
    await as('owner');
    expect((await q(`select id from base_vehicles where id='АВТО-002'`)).length).toBe(1);
  });
  it('Storage: бачить файли авто, не бачить рахунків; не завантажує', async () => {
    await as('member');
    expect((await q('select name from storage.objects')).map(r => r.name)).toEqual(['vehicles/АВТО-001/a.jpg']);
    expect(await fails(`insert into storage.objects (bucket_id, name) values ('base-files','vehicles/АВТО-001/b.jpg')`)).toBe(true);
  });
});

describe('RLS: керівник', () => {
  it('читає все, включно з фінансами та журналом', async () => {
    await as('head');
    expect((await q('select * from base_finance')).length).toBe(1);
    expect((await q('select * from base_debts_by_person'))[0].person).toBe('Особа А');
    expect((await q('select * from base_audit_log')).length).toBeGreaterThan(0);
    expect((await q('select name from storage.objects')).length).toBe(2);
  });
  it('змінює статус; журнал змін пишеться тригером попри те, що напряму писати не можна', async () => {
    await as('head');
    await db.exec(`update base_vehicles set status='Діагностика' where id='АВТО-001'`);
    expect((await q(`select status from base_vehicles where id='АВТО-001'`))[0].status).toBe('Діагностика');
    expect((await q(`select 1 from base_audit_log where table_name='base_vehicles' and op='UPDATE' and user_id='${HEAD}'`)).length).toBe(1);
    expect(await fails(`insert into base_audit_log (table_name, op) values ('x','y')`)).toBe(true);
    await db.exec(`update base_vehicles set status='В ремонті' where id='АВТО-001'`);
  });
  it('додає роботу, запчастину, фінанс, файл', async () => {
    await as('head');
    await db.exec(`insert into base_jobs (vehicle_id, description, status) values ('АВТО-001','нова','Заплановано')`);
    await db.exec(`insert into base_parts (vehicle_id, name, qty, status) values ('АВТО-001','Фільтр',1,'Замовлено')`);
    await db.exec(`insert into base_finance (scope, vehicle_id, amount) values ('vehicle','АВТО-001',5)`);
    await db.exec(`insert into storage.objects (bucket_id, name) values ('base-files','vehicles/АВТО-001/c.jpg')`);
  });
  it('Storage: чужий шлях поза vehicles/ і finance/ завантажити не можна', async () => {
    await as('head');
    expect(await fails(`insert into storage.objects (bucket_id, name) values ('base-files','secret/x.pdf')`)).toBe(true);
  });
});

describe('RLS: сторонні', () => {
  it('авторизований, але не з команди: нічого не бачить і не пише', async () => {
    await as('stranger');
    expect(await q('select * from base_vehicles')).toEqual([]);
    expect(await q('select * from base_finance')).toEqual([]);
    expect(await q('select * from storage.objects')).toEqual([]);
    expect(await fails(`insert into base_vehicles (id, name, status) values ('X','x','Прийнято')`)).toBe(true);
  });
  it('anon: доступу до таблиць немає взагалі', async () => {
    await as('anon');
    expect(await fails('select * from base_vehicles')).toBe(true);
    expect(await fails('select * from base_finance')).toBe(true);
  });
});

describe('RLS: таблиці модуля', () => {
  it('у кожній base_ таблиці увімкнено RLS (щоб нова таблиця не лишилась відкритою)', async () => {
    await as('owner');
    const rows = await q(`select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind='r' and relname like 'base\\_%' and not relrowsecurity`);
    expect(rows).toEqual([]);
  });
});
