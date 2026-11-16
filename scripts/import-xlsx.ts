// Використання:
//   DATABASE_URL=postgres://... npx tsx scripts/import-xlsx.ts --file шлях/до/таблиці.xlsx          (лише план)
//   DATABASE_URL=postgres://... npx tsx scripts/import-xlsx.ts --file ... --apply                    (записати нове)
// Файл таблиці НЕ комітити: у ньому реальні дані.
import pg from 'pg';
import { parseWorkbook } from '../src/import/parse';
import { planSync, applyPlan, formatReport } from '../src/import/sync';

const args = process.argv.slice(2);
const file = args[args.indexOf('--file') + 1];
const apply = args.includes('--apply');
if (!file || args.indexOf('--file') < 0) { console.error('Вкажіть --file шлях.xlsx'); process.exit(2); }
if (!process.env.DATABASE_URL) { console.error('Задайте DATABASE_URL'); process.exit(2); }

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const parsed = await parseWorkbook(file);
  const plan = await planSync(client as any, parsed);
  if (!apply) { console.log(formatReport(plan)); console.log('\nЩоб записати нові рядки, додайте --apply'); }
  else { const done = await applyPlan(client as any, plan); console.log(formatReport(plan, done)); }
} finally { await client.end(); }
