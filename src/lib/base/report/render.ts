// Формування PDF у браузері. Бібліотека важка (~1 МБ), тому файл підвантажується лише на клік
// (динамічний import з компонента), а не разом зі сторінкою.
import { createElement } from 'react';
import { pdf } from '@react-pdf/renderer';
import type { DonorReportModel } from './model';
import { DonorReportDocument, registerReportFonts } from './pdf';
import { REPORT_FONT_BASE } from '../config';

/** Повна адреса шрифту: react-pdf не приймає відносних адрес («Invalid URL»). */
const absoluteFont = (file: string) => new URL(REPORT_FONT_BASE + file, window.location.href).href;

export async function renderDonorReportPdf(model: DonorReportModel, fontSrc: (file: string) => string = absoluteFont): Promise<Blob> {
  registerReportFonts(fontSrc);
  // react-pdf типізує pdf() під свій <Document>; наш компонент повертає саме його
  return pdf(createElement(DonorReportDocument, { m: model }) as Parameters<typeof pdf>[0]).toBlob();
}

/** Ім'я файлу: zvit-AVTO-003-2026-11-17.pdf (латиницею — без проблем у месенджерах і пошті). */
export function reportFileName(vehicleId: string, now: Date, draft: boolean): string {
  const map: Record<string, string> = { А: 'A', В: 'V', Т: 'T', О: 'O' };
  const id = vehicleId.replace(/[А-ЯІЇЄҐ]/g, ch => map[ch] ?? 'X');
  return `zvit-${id}-${now.toISOString().slice(0, 10)}${draft ? '-chernetka' : ''}.pdf`;
}
