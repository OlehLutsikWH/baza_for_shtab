// Перевірка готового PDF: потрібне є, приватного немає. Текст витягується pdftotext (poppler);
// якщо його немає в системі — тест пропускається.
import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToBuffer } from '@react-pdf/renderer';
import { demoData, draftReport } from '../src/lib/base/demoData';
import { buildDonorReport, type ReportInput } from '../src/lib/base/report/model';
import { DonorReportDocument, registerReportFonts } from '../src/lib/base/report/pdf';
import { reportFileName } from '../src/lib/base/report/render';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let hasPdftotext = true;
try { execFileSync('pdftotext', ['-v'], { stdio: 'ignore' }); } catch { hasPdftotext = false; }
const NOW = new Date('2026-11-17T10:00:00Z');
const dir = mkdtempSync(join(tmpdir(), 'zvit-'));

function input(id: string, patch: Partial<ReportInput> = {}): ReportInput {
  const d = demoData(NOW);
  return {
    vehicle: d.vehicles.find(v => v.id === id)!, jobs: d.jobs.filter(j => j.vehicle_id === id), parts: d.parts.filter(p => p.vehicle_id === id),
    finance: d.finance.filter(f => f.vehicle_id === id), report: d.reports.find(r => r.vehicle_id === id) ?? null, now: NOW, ...patch,
  };
}
async function pdfText(inp: ReportInput, name: string) {
  const buf = await renderToBuffer(<DonorReportDocument m={buildDonorReport(inp)} />);
  expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  const file = join(dir, name);
  writeFileSync(file, buf);
  const text = execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' });
  const pages = Number(/Pages:\s+(\d+)/.exec(execFileSync('pdfinfo', [file], { encoding: 'utf8' }))![1]);
  return { text: text.replace(/ /g, ' '), pages };
}
const SECRETS = ['TEST-VIN-0003', 'АА0003ТТ', 'Контакт Частини 1', 'Майстер Петро', 'Маляр Тест', 'Місто 2', 'Місто 3', 'Постачальник 2', 'Особа Б', 'Рахунок №17', 'ФОП Тестовий', 'Службова примітка', 'Координатор'];

beforeAll(() => registerReportFonts(f => join(root, 'public', 'base', 'fonts', f)));

describe.skipIf(!hasPdftotext)('PDF звіту', () => {
  it('чернетка: ключові дані на місці, позначка «чернетка» є', async () => {
    const { text, pages } = await pdfText(input('АВТО-003'), 'a.pdf');
    for (const s of ['Тестовий Джип В', 'звіт про ремонт', '72 100,50 грн', '72 100 грн', 'Запчастини', 'Доставка', 'Пальне', 'Оформлення', 'Фарбування',
      'Доставка авто з ЄС до СТО', 'в процесі', 'Ремонт передньої підвіски', 'Сайлентблоки важелів', 'Дякуємо', 'tykho.org', 'ЧЕРНЕТКА', 'Частина 1']) {
      expect(text, s).toContain(s);
    }
    expect(pages).toBeLessThanOrEqual(4);
  });
  it('приватне в PDF не потрапляє', async () => {
    const { text } = await pdfText(input('АВТО-003'), 'b.pdf');
    for (const s of SECRETS) expect(text, s).not.toContain(s);
  });
  it('фінальна версія без позначки; підрозділ ховається; рахунки можна прибрати', async () => {
    const rep = { ...draftReport('АВТО-003'), show_unit: false, show_invoices: false };
    const { text } = await pdfText(input('АВТО-003', { report: rep, final: true }), 'c.pdf');
    expect(text).not.toContain('ЧЕРНЕТКА');
    expect(text).not.toContain('Частина 1');
    expect(text).not.toContain('Кожна витрата окремо');
    expect(text).toContain('72 100,50 грн');
  });
  it('авто без витрат і фото теж складається без помилок', async () => {
    const d = demoData(NOW);
    const { text } = await pdfText({ vehicle: d.vehicles.find(v => v.id === 'АВТО-005')!, jobs: [], parts: [], finance: [], report: null, now: NOW }, 'd.pdf');
    expect(text).toContain('Витрат по цьому авто не записано.');
    expect(text).not.toMatch(/undefined|NaN|null/);
  });
});

describe('ім’я файлу звіту', () => {
  it('латиницею, з датою і позначкою чернетки', () => {
    expect(reportFileName('АВТО-003', NOW, true)).toBe('zvit-AVTO-003-2026-11-17-chernetka.pdf');
    expect(reportFileName('АВТО-003', NOW, false)).toBe('zvit-AVTO-003-2026-11-17.pdf');
  });
});
