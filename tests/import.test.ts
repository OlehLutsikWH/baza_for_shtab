import { describe, it, expect, beforeEach } from 'vitest';
import ExcelJS from 'exceljs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { freshDb } from './helpers';
import { parseWorkbook } from '../src/import/parse';
import { planSync, applyPlan, formatReport } from '../src/import/sync';

// ---- Вигадана таблиця зі «справжніми» вадами
async function makeWorkbook(mutate?: (wb: ExcelJS.Workbook) => void): Promise<string> {
  const wb = new ExcelJS.Workbook();
  const veh = wb.addWorksheet('Автомобілі');
  veh.addRow(['ID_авто','Назва_марка_модель','Тип','VIN','Держ_номер','Статус','Хто_надіслав_запит','Військова_частина','Призначення','Дата_прийому','Дата_передачі','Посилання_на_фото','Примітки']);
  veh.addRow(['АВТО-001','Тест Один','Позашляховик','VIN-ТЕСТ-1','АА0001ТТ','В ремонті','Особа X','Частина 1',null,new Date('2026-05-20T00:00:00Z'),null,null,'нотатка']);
  veh.addRow(['АВТО-002','Тест Два','Мікроавтобус',null,null,'Прийнято',null,null,null,'20.05.2026',null,null,null]);
  veh.addRow(['АВТО-003','Тест Три','Позашляховик',null,null,'Вигаданий статус',null,null,null,null,null,null,null]);

  const jobs = wb.addWorksheet('Ремонтні_роботи');
  jobs.addRow(['ID_роботи','ID_авто','Назва_авто','Опис_роботи','Виконавець','Місце знаходження','Статус','Дата_початку','Дата_закінчення','Примітки','Тривалість, днів']);
  jobs.addRow(['РОБ-001','АВТО-001',{ formula: 'X', result: 'Тест Один' },'Капітальний ремонт двигуна','Майстер А','Місто1','Завершено',new Date('2026-08-01T00:00:00Z'),new Date('2026-08-11T00:00:00Z'),null,{ formula: 'Y', result: 10 }]);
  jobs.addRow(['РОБ-001','АВТО-001',null,'Капітальний ремонт двигуна','Майстер А','Місто1','Завершено',new Date('2026-08-01T00:00:00Z'),new Date('2026-08-11T00:00:00Z'),null,null]); // точний повтор
  jobs.addRow(['РОБ-777','АВТО-002',null,'Невідома робота','Майстер Б',null,'В процесі',new Date('2026-09-01T00:00:00Z'),null,null,null]);   // ID немає в номенклатурі
  jobs.addRow(['РОБ-001','АВТО-999',null,'Авто немає','X',null,'Завершено',null,null,null,null]);                                                // нема авто
  const strayRow = jobs.addRow(['РОБ-002','АВТО-002',null,'Ремонт двигуна (поточний)','Майстер Б',null,'Заплановано',null,null,'примітка']);
  strayRow.getCell(23).value = 'орієнтовно по 3 тисячі за штуку';                                                                                  // поза таблицею

  const parts = wb.addWorksheet('Запчастини');
  parts.addRow(['ID_запчастини','ID_авто','Назва_авто','Назва_запчастини','Кількість','Статус','Постачальник','Вартість_грн','Дата_замовлення','Дата_отримання','Примітки']);
  parts.addRow(['ЗЧ-011','АВТО-001',null,'Форсунка','4','Встановлено','Постачальник 1','19 600,50 грн',new Date('2026-08-05T00:00:00Z'),null,null]);
  parts.addRow(['ЗЧ-011','АВТО-001',null,'Форсунка','0','Встановлено','Постачальник 1','100',null,null,null]);   // кількість 0

  const fin = wb.addWorksheet('Фінанси');
  fin.addRow(['ID_витрати','ID_авто','Назва_авто','Сума_грн','Дата','На_що_витрачено','Документ','Джерело_коштів','ПІБ_особи ДеЮрЕ','Контакт_особи відповідальної','Статус_оплати','Дата_оплати','Примітки','Всього ще винні цій особі, ₴','Кому сплачено (де-юре)','Кому сплачено (де-факто)','Рахунок / акт (посилання)']);
  fin.addRow([null,'АВТО-001',null,5000,new Date('2026-07-24T00:00:00Z'),{ text: '5000,00 грн', hyperlink: 'https://example.test/a' },{ text: 'Акт №1', hyperlink: 'https://example.test/b' },'Збір','Особа А',null,'Оплачено',new Date('2026-07-24T00:00:00Z'),null,null,null,null,null]);
  fin.addRow([null,'АВТО-001',null,'2 000,25',null,null,'Накладна','Фандрайзинг','Особа А',null,'Очікує оплати',null,null,null,null,null,null]);
  fin.addRow([null,'АВТО-002',null,300,null,null,null,'Бюджет СТО','Особа Б',null,'Очікує оплати',null,null,null,null,null,null]);  // джерела немає в довіднику

  const docs = wb.addWorksheet('Документи');
  docs.addRow(['ID_документа','ID_авто','Назва_авто','Тип_документа','Посилання_на_файл','Дата','Хто_завантажив','Примітки']);
  docs.addRow([null,'АВТО-001',null,'Акт приймання-передачі (гума)',{ text: 'файл', hyperlink: 'https://example.test/doc' },new Date('2026-05-21T00:00:00Z'),'Особа В',null]);

  const nom = wb.addWorksheet('Номенклатура');
  nom.addRow(['Номенклатура — стандартні назви']); nom.addRow([]); nom.addRow(['РОБОТИ']);
  nom.addRow(['ID','Стандартна_назва','Категорія','Альтернативні назви / примітки','Час прогнозований','План сервісу','Фактичне середнє']);
  nom.addRow(['РОБ-001','Капітальний ремонт двигуна','Двигун','капремонт',56,'Високий',{ formula: 'Z', result: 5 }]);
  nom.addRow(['РОБ-002','Ремонт двигуна (поточний)','Двигун','ремонт ДВЗ',24,'Середній',null]);
  nom.addRow(['ЗАПЧАСТИНИ']); nom.addRow(['ID','Стандартна_назва','Категорія','Альтернативні назви']);
  nom.addRow(['ЗЧ-011','Форсунки паливні','Двигун','інжектори']);
  nom.addRow(['ДОКУМЕНТИ']); nom.addRow(['ID','Стандартна_назва','Категорія','Альтернативні назви']);
  nom.addRow(['ДОК-001','Акт приймання-передачі (гума)','Приймання','акт прийому']);

  const mod = wb.addWorksheet('Довідник_авто');
  mod.addRow(['Довідник моделей']); mod.addRow(['Повний список моделей:']);
  mod.addRow(['ID_моделі','Марка_модель','Тип','Типовий двигун / паливо','Базовий інтервал ТО','Відомі слабкі місця','Доступність запчастин','На що звернути увагу','Статус даних']);
  mod.addRow(['МОД-001','Тест Модель','Буса','2.0 дизель','10 000 км','слабке місце','Висока','перевірити','Досліджено']);

  mutate?.(wb);
  const path = join(mkdtempSync(join(tmpdir(), 'baza-')), 'test.xlsx');
  await wb.xlsx.writeFile(path);
  return path;
}

let db: PGlite;
beforeEach(async () => { db = await freshDb(); });

describe('розбір xlsx', () => {
  it('читає дати, числа з пробілами/комою, посилання в комірках; ігнорує формули', async () => {
    const p = await parseWorkbook(await makeWorkbook());
    expect(p.vehicles.map(v => v.id)).toEqual(['АВТО-001', 'АВТО-002', 'АВТО-003']);
    expect(p.vehicles[0].received_on).toBe('2026-05-20');
    expect(p.vehicles[1].received_on).toBe('2026-05-20');           // рядкова дата 20.05.2026
    expect(p.parts[0].cost_total).toBe(19600.5);                     // «19 600,50 грн»
    expect(p.finance[1].amount).toBe(2000.25);                       // «2 000,25»
    expect(p.finance[0].legacy_links?.map(l => [l.field, l.url])).toEqual([['purpose', 'https://example.test/a'], ['doc', 'https://example.test/b']]);
    expect(p.finance[0].doc_ref).toBe('Акт №1');
    expect(p.jobs[0].nomenclature_id).toBe('РОБ-001');
    expect(p.nomenclature.map(n => n.id)).toEqual(['РОБ-001', 'РОБ-002', 'ЗЧ-011', 'ДОК-001']);
    expect(p.nomenclature[0].planned_days).toBe(56);
    expect(p.models[0]).toMatchObject({ id: 'МОД-001', vehicle_type: 'Буса' });
  });

  it('попереджає про дані поза таблицею, а не губить мовчки', async () => {
    const p = await parseWorkbook(await makeWorkbook());
    expect(p.warnings.some(w => w.sheet === 'Ремонтні_роботи' && /поза таблицею.*3 тисячі/.test(w.message))).toBe(true);
  });

  it('пропускає аркуш без обов’язкових заголовків з поясненням', async () => {
    const path = await makeWorkbook(wb => { wb.getWorksheet('Фінанси')!.getRow(1).getCell(4).value = 'Інша_назва'; });
    const p = await parseWorkbook(path);
    expect(p.finance).toHaveLength(0);
    expect(p.warnings.some(w => w.sheet === 'Фінанси' && /Немає потрібних заголовків/.test(w.message))).toBe(true);
  });
});

describe('план і запис', () => {
  it('відхиляє погане з причиною, решту планує; dry-run нічого не пише', async () => {
    const plan = await planSync(db, await parseWorkbook(await makeWorkbook()));
    const reasons = plan.rejected.map(r => `${r.table}:${r.reason}`).join('\n');
    expect(reasons).toMatch(/base_vehicles:.*Вигаданий статус/);
    expect(reasons).toMatch(/base_jobs:Авто АВТО-999/);
    expect(reasons).toMatch(/base_parts:Кількість/);
    expect(reasons).toMatch(/base_finance:.*Бюджет СТО/);
    expect(plan.inserts.base_vehicles.map(v => v.id)).toEqual(['АВТО-001', 'АВТО-002']);
    expect(plan.inserts.base_jobs).toHaveLength(4);   // РОБ-001 ×2, РОБ-777, РОБ-002 (АВТО-999 відхилено)
    expect((await db.query<any>('select count(*)::int as n from base_vehicles')).rows[0].n).toBe(0);
    expect(plan.warnings.some(w => /РОБ-777.*немає в номенклатурі/.test(w.message))).toBe(true);
  });

  it('точні повтори рядків зберігаються обидва (лічильник), apply записує все нове', async () => {
    const path = await makeWorkbook();
    const plan = await planSync(db, await parseWorkbook(path));
    const done = await applyPlan(db, plan);
    expect(done.base_jobs).toBe(4);
    const q = async (s: string) => (await db.query<any>(s)).rows;
    expect((await q(`select count(*)::int n from base_jobs where nomenclature_id='РОБ-001'`))[0].n).toBe(2);
    expect((await q(`select nomenclature_id from base_jobs where description='Невідома робота'`))[0].nomenclature_id).toBeNull();
    const f = await q(`select amount::float8 a, legacy_links from base_finance order by id`);
    expect(f.map(x => x.a)).toEqual([5000, 2000.25]);
    expect(f[0].legacy_links[0].url).toBe('https://example.test/a');
    expect((await q(`select doc_type_id from base_documents`))[0].doc_type_id).toBe('ДОК-001');
  });

  it('повторний імпорт ідемпотентний: нічого нового, нічого не дублюється', async () => {
    const path = await makeWorkbook();
    await applyPlan(db, await planSync(db, await parseWorkbook(path)));
    const again = await planSync(db, await parseWorkbook(path));
    for (const t of Object.keys(again.inserts)) expect(again.inserts[t], t).toHaveLength(0);
    expect(again.conflicts).toHaveLength(0);
    expect(again.orphans).toHaveLength(0);
    await applyPlan(db, again);
    expect((await db.query<any>('select count(*)::int n from base_jobs')).rows[0].n).toBe(4);
  });

  it('змінене у файлі авто — розбіжність, а не перезапис', async () => {
    const path = await makeWorkbook();
    await applyPlan(db, await planSync(db, await parseWorkbook(path)));
    await db.exec(`update base_vehicles set status = 'Готовий' where id = 'АВТО-001'`);      // правка в застосунку
    const plan = await planSync(db, await parseWorkbook(path));
    const c = plan.conflicts.find(x => x.id === 'АВТО-001')!;
    expect(c.diffs).toEqual([{ field: 'status', db: 'Готовий', file: 'В ремонті' }]);
    await applyPlan(db, plan);
    expect((await db.query<any>(`select status from base_vehicles where id='АВТО-001'`)).rows[0].status).toBe('Готовий');
    expect(formatReport(plan)).toMatch(/РОЗБІЖНОСТІ.*НЕ перезаписано/);
  });

  it('змінений у файлі рядок роботи: з’являється як новий, а старий — у списку «є в базі, немає у файлі»', async () => {
    const path = await makeWorkbook();
    await applyPlan(db, await planSync(db, await parseWorkbook(path)));
    const path2 = await makeWorkbook(wb => { wb.getWorksheet('Ремонтні_роботи')!.getRow(2).getCell(5).value = 'Майстер Новий'; });
    const plan = await planSync(db, await parseWorkbook(path2));
    expect(plan.inserts.base_jobs).toHaveLength(1);
    expect(plan.orphans.filter(o => o.table === 'base_jobs')).toHaveLength(1);
  });

  it('помилка під час запису відкочує все (транзакція)', async () => {
    const plan = await planSync(db, await parseWorkbook(await makeWorkbook()));
    plan.inserts.base_finance.push({ vehicle_id: 'АВТО-001', amount: -5, pay_status: 'Оплачено', import_key: 'bad' }); // порушує check
    await expect(applyPlan(db, plan)).rejects.toThrow();
    expect((await db.query<any>('select count(*)::int n from base_vehicles')).rows[0].n).toBe(0);
  });
});

describe('фінанси без авто', () => {
  const withUnassigned = (wb: ExcelJS.Workbook) => {
    wb.getWorksheet('Фінанси')!.addRow([null, null, null, 32100, new Date('2026-09-09T00:00:00Z'), 'Оренда СТО', 'Платіжка', 'Збір', 'Особа Г', null, 'Оплачено', null, null, null, null, null, null]);
  };

  it('не втрачаються: імпортуються як «unassigned» з попередженням', async () => {
    const p = await parseWorkbook(await makeWorkbook(withUnassigned));
    const un = p.finance.filter(f => f.scope === 'unassigned');
    expect(un).toHaveLength(1);
    expect(un[0].amount).toBe(32100);
    const plan = await planSync(db, p);
    expect(plan.warnings.some(w => /не віднесено.*32100/.test(w.message))).toBe(true);
    await applyPlan(db, plan);
    const r = (await db.query<any>(`select scope, vehicle_id from base_finance where amount = 32100`)).rows[0];
    expect(r).toEqual({ scope: 'unassigned', vehicle_id: null });
  });

  it('борги по особі враховують і рядки без авто, а витрати по авто — ні', async () => {
    await db.exec(`insert into base_vehicles (id, name) values ('АВТО-001','Т');
      insert into base_finance (scope, vehicle_id, amount, person_dejure, pay_status) values
        ('vehicle','АВТО-001',100,'Особа А','Очікує оплати'),
        ('shared', null, 900,'Особа А','Очікує оплати'),
        ('general',null, 50,'Особа А','Оплачено');`);
    const debt = (await db.query<any>(`select owed_total::float8 as t from base_debts_by_person where person='Особа А'`)).rows[0].t;
    const spent = (await db.query<any>(`select spent_total::float8 as t from base_spend_by_vehicle where vehicle_id='АВТО-001'`)).rows[0].t;
    expect(debt).toBe(1000);
    expect(spent).toBe(100);
  });

  it('база не пускає рядок «vehicle» без авто і «shared» з авто', async () => {
    await db.exec(`insert into base_vehicles (id, name) values ('АВТО-001','Т')`);
    await expect(db.exec(`insert into base_finance (scope, amount) values ('vehicle', 1)`)).rejects.toThrow();
    await expect(db.exec(`insert into base_finance (scope, vehicle_id, amount) values ('shared','АВТО-001', 1)`)).rejects.toThrow();
  });
});
