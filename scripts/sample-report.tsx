// Зразок звіту з ДЕМО-даних: npm run report:sample -- [АВТО-003] [out.pdf]
import { renderToFile } from '@react-pdf/renderer';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { demoData } from '../src/lib/base/demoData';
import { buildDonorReport } from '../src/lib/base/report/model';
import { DonorReportDocument, registerReportFonts } from '../src/lib/base/report/pdf';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const id = process.argv[2] ?? 'АВТО-003';
const out = process.argv[3] ?? join(root, 'demo', 'dist', `zrazok-zvitu-${id}.pdf`);
const now = new Date();
const d = demoData(now);
const vehicle = d.vehicles.find(v => v.id === id);
if (!vehicle) throw new Error(`Немає ${id} у демо-даних`);
const model = buildDonorReport({
  vehicle, jobs: d.jobs.filter(j => j.vehicle_id === id), parts: d.parts.filter(p => p.vehicle_id === id),
  finance: d.finance.filter(f => f.vehicle_id === id), report: d.reports.find(r => r.vehicle_id === id) ?? null, now,
});
registerReportFonts(f => join(root, 'public', 'base', 'fonts', f));
await renderToFile(<DonorReportDocument m={model} />, out);
console.log(out);
