// Зразок звіту з ДЕМО-даних: npm run report:sample -- [АВТО-003] [out.pdf]
import { renderToFile } from '@react-pdf/renderer';
import { join, dirname } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { demoData } from '../src/lib/base/demoData';
import { buildDonorReport } from '../src/lib/base/report/model';
import { DonorReportDocument, registerReportFonts } from '../src/lib/base/report/pdf';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2).filter((a, i, all) => !all.slice(0, i + 1).includes('--photos'));
const id = args[0] ?? 'АВТО-003';
const out = args[1] ?? join(root, 'demo', 'dist', `zrazok-zvitu-${id}.pdf`);
const now = new Date();
const d = demoData(now);
const vehicle = d.vehicles.find(v => v.id === id);
if (!vehicle) throw new Error(`Немає ${id} у демо-даних`);
// --photos a.png b.png … — підставити зображення (для перевірки верстки з фото; перше — «після»)
const pi = process.argv.indexOf('--photos');
const images = pi > 0 ? process.argv.slice(pi + 1).map((f, i) => ({
  src: `data:image/${f.endsWith('.png') ? 'png' : 'jpeg'};base64,${readFileSync(f).toString('base64')}`, caption: `Фото ${i + 1}`, kind: (i === 0 ? 'після' : 'до') as 'до' | 'після',
})) : [];
const model = buildDonorReport({
  vehicle, jobs: d.jobs.filter(j => j.vehicle_id === id), parts: d.parts.filter(p => p.vehicle_id === id),
  finance: d.finance.filter(f => f.vehicle_id === id), report: d.reports.find(r => r.vehicle_id === id) ?? null, now, images,
});
registerReportFonts(f => join(root, 'public', 'base', 'fonts', f));
await renderToFile(<DonorReportDocument m={model} />, out);
console.log(out);
