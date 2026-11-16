import { describe, it, expect, beforeEach } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { freshDb, seed } from './helpers';

let db: PGlite;
beforeEach(async () => { db = await freshDb(); await seed(db); });

const one = async (sql: string) => (await db.query<any>(sql)).rows[0];
const all = async (sql: string) => (await db.query<any>(sql)).rows;

describe('тривалість робіт', () => {
  it('рахується лише для «Завершено» з обома датами', async () => {
    await db.exec(`
      insert into base_jobs (vehicle_id, nomenclature_id, status, started_on, finished_on) values
        ('АВТО-001','РОБ-001','Завершено','2026-08-01','2026-08-11'),   -- 10
        ('АВТО-001','РОБ-001','Завершено','2026-08-01', null),          -- немає кінця
        ('АВТО-001','РОБ-001','В процесі','2026-08-01','2026-08-20'),   -- не завершено
        ('АВТО-001','РОБ-001','Завершено', null,'2026-08-20'),          -- немає початку
        ('АВТО-001','РОБ-001','Завершено','2026-08-10','2026-08-10');   -- 0 днів
    `);
    const rows = await all(`select status, duration_days from base_jobs_v order by id`);
    expect(rows.map(r => r.duration_days)).toEqual([10, null, null, null, 0]);
  });

  it('не дозволяє кінець раніше за початок', async () => {
    await expect(db.exec(`insert into base_jobs (vehicle_id, status, started_on, finished_on)
      values ('АВТО-001','Завершено','2026-08-10','2026-08-01')`)).rejects.toThrow();
  });
});

describe('фактичне середнє по номенклатурі', () => {
  it('округлення до 0,1, нулі враховуються, незавершені ні', async () => {
    await db.exec(`
      insert into base_jobs (vehicle_id, nomenclature_id, status, started_on, finished_on) values
        ('АВТО-001','РОБ-001','Завершено','2026-01-01','2026-01-11'),  -- 10
        ('АВТО-002','РОБ-001','Завершено','2026-01-01','2026-01-06'),  -- 5
        ('АВТО-003','РОБ-001','Завершено','2026-01-01','2026-01-02'),  -- 1
        ('АВТО-003','РОБ-001','В процесі','2026-01-01',null),          -- ігнор
        ('АВТО-001','РОБ-002','Завершено','2026-01-05','2026-01-05');  -- 0
    `);
    const m = Object.fromEntries((await all(`select id, actual_avg_days, completed_jobs from base_nomenclature_actual`))
      .map(r => [r.id, r]));
    expect(Number(m['РОБ-001'].actual_avg_days)).toBe(5.3);   // (10+5+1)/3 = 5,333…
    expect(Number(m['РОБ-001'].completed_jobs)).toBe(3);
    expect(Number(m['РОБ-002'].actual_avg_days)).toBe(0);
    expect(m['РОБ-099'].actual_avg_days).toBeNull();           // нема даних → порожньо
  });
});

describe('борг по особі', () => {
  it('сума лише «Очікує оплати», по person_dejure, порожніх осіб ігноруємо', async () => {
    await db.exec(`
      insert into base_finance (vehicle_id, amount, source, person_dejure, pay_status) values
        ('АВТО-001', 1000.50,'Збір','Особа А','Очікує оплати'),
        ('АВТО-002', 2000.25,'Збір','Особа А','Очікує оплати'),
        ('АВТО-002',  500.00,'Збір','Особа А','Оплачено'),          -- не рахується
        ('АВТО-001',  700.00,'Фандрайзинг','Особа Б','Очікує оплати'),
        ('АВТО-001',  300.00,'Збір', null,'Очікує оплати'),          -- без особи
        ('АВТО-001',  300.00,'Збір','   ','Очікує оплати');          -- порожній рядок
    `);
    const rows = await all(`select person, owed_total, items from base_debts_by_person order by person`);
    expect(rows.map(r => [r.person, Number(r.owed_total), Number(r.items)]))
      .toEqual([['Особа А', 3000.75, 2], ['Особа Б', 700, 1]]);
  });
});

describe('витрати по авто', () => {
  it('розбивка на оплачено / очікує, авто без витрат дає нулі', async () => {
    await db.exec(`
      insert into base_finance (vehicle_id, amount, pay_status) values
        ('АВТО-001', 100,'Оплачено'), ('АВТО-001', 50.5,'Очікує оплати');
    `);
    const m = Object.fromEntries((await all(`select * from base_spend_by_vehicle`)).map(r => [r.vehicle_id, r]));
    expect(Number(m['АВТО-001'].spent_total)).toBe(150.5);
    expect(Number(m['АВТО-001'].paid_total)).toBe(100);
    expect(Number(m['АВТО-001'].pending_total)).toBe(50.5);
    expect(Number(m['АВТО-003'].spent_total)).toBe(0);
  });
});

describe('дашборд', () => {
  it('рахує авто по статусах, порожні статуси показує з нулем', async () => {
    const m = Object.fromEntries((await all(`select * from base_dashboard_counts`)).map(r => [r.status, Number(r.vehicles)]));
    expect(m).toEqual({ 'Прийнято': 1, 'Діагностика': 0, 'В ремонті': 1, 'Готовий': 1, 'Передано частині': 0 });
  });
});

describe('цілісність і журнал', () => {
  it('відхиляє статус, якого немає в довіднику', async () => {
    await expect(db.exec(`insert into base_vehicles (id, name, status) values ('АВТО-010','X','Вигаданий')`))
      .rejects.toThrow(/Недопустиме значення/);
    await expect(db.exec(`insert into base_finance (vehicle_id, amount, source) values ('АВТО-001',1,'Бюджет СТО')`))
      .rejects.toThrow(/Недопустиме значення/);
  });

  it('відхиляє формат ID авто', async () => {
    await expect(db.exec(`insert into base_vehicles (id, name) values ('CAR-1','X')`)).rejects.toThrow();
  });

  it('status_updated_at змінюється лише при зміні статусу/блокера/кроку/відповідального', async () => {
    await db.exec(`update base_vehicles set status_updated_at = '2020-01-01' where id='АВТО-001'`);
    await db.exec(`update base_vehicles set notes = 'лише примітка' where id='АВТО-001'`);
    expect((await one(`select status_updated_at < '2021-01-01' as old from base_vehicles where id='АВТО-001'`)).old).toBe(true);
    await db.exec(`update base_vehicles set blocker = 'чекаємо запчастину' where id='АВТО-001'`);
    expect((await one(`select status_updated_at > '2021-01-01' as fresh from base_vehicles where id='АВТО-001'`)).fresh).toBe(true);
  });

  it('пише журнал змін зі старим і новим значенням', async () => {
    await db.exec(`update base_vehicles set status='Готовий' where id='АВТО-001'`);
    const r = await one(`select op, old_row->>'status' as o, new_row->>'status' as n
      from base_audit_log where table_name='base_vehicles' and row_id='АВТО-001' and op='UPDATE'`);
    expect([r.op, r.o, r.n]).toEqual(['UPDATE', 'В ремонті', 'Готовий']);
  });
});

describe('очікують оплати без особи', () => {
  it('показуються окремо і не потрапляють у борги по особах', async () => {
    await db.exec(`
      insert into base_finance (vehicle_id, amount, person_dejure, pay_status) values
        ('АВТО-001', 30000, null,  'Очікує оплати'),
        ('АВТО-001', 100,   'Х',   'Очікує оплати'),
        ('АВТО-001', 5,     null,  'Оплачено');`);
    const un = await all(`select amount::float8 as a from base_pending_unattributed`);
    expect(un.map(r => r.a)).toEqual([30000]);
    expect((await all(`select person from base_debts_by_person`)).map(r => r.person)).toEqual(['Х']);
  });
});
