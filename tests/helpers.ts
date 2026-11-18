import { fileURLToPath } from "node:url"; import { dirname as _d } from "node:path"; const dirname = _d(fileURLToPath(import.meta.url));
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FILES = ['base_000_standalone_stubs.sql', 'base_001_schema.sql', 'base_002_views.sql', 'base_003_rls.sql', 'base_004_donor_reports.sql', 'base_005_bot.sql', 'base_006_bot_uploads.sql', 'base_007_bot_drafts.sql'];

export async function freshDb(): Promise<PGlite> {
  const db = new PGlite();
  for (const f of FILES) {
    await db.exec(readFileSync(join(dirname, '..', 'supabase', f), 'utf8'));
  }
  return db;
}

// Вигадані дані. Реальних VIN, номерів і сум тут немає.
export async function seed(db: PGlite) {
  await db.exec(`
    insert into base_nomenclature (id, kind, name, category, planned_days, delay_risk) values
      ('РОБ-001','work','Капітальний ремонт двигуна','Двигун',56,'Високий'),
      ('РОБ-002','work','Ремонт двигуна (поточний)','Двигун',24,'Середній'),
      ('РОБ-099','work','Невикористана робота','Інше',3,'Низький'),
      ('ЗЧ-011','part','Форсунки паливні','Двигун',null,null);
    insert into base_vehicles (id, name, vehicle_type, status) values
      ('АВТО-001','Тест Один','Позашляховик','В ремонті'),
      ('АВТО-002','Тест Два','Мікроавтобус','Прийнято'),
      ('АВТО-003','Тест Три',null,'Готовий');
  `);
}
