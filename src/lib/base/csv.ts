import type { FinanceItem, VehicleSummary } from './types';

/** CSV з роздільником «;» і BOM — Excel українською відкриває без налаштувань. Захист від формул (=,+,-,@). */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const esc = (v: string | number | null | undefined) => {
    if (v == null) return '';
    let t = String(v);
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(t)) t = "'" + t;
    return /[;"\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return '﻿' + rows.map(r => r.map(esc).join(';')).join('\r\n') + '\r\n';
}

export const vehiclesCsv = (list: VehicleSummary[]) => toCsv([
  ['ID', 'Назва', 'Тип', 'VIN', 'Держномер', 'Статус', 'Блокер', 'Що далі', 'Відповідальний', 'Частина', 'Прийнято', 'Передано', 'Відкритих робіт', 'Запчастин чекаємо'],
  ...list.map(v => [v.id, v.name, v.vehicle_type, v.vin, v.plate, v.status, v.blocker, v.next_step, v.responsible, v.military_unit, v.received_on, v.handed_over_on, v.open_jobs, v.parts_to_get]),
]);

export const financeCsv = (items: FinanceItem[]) => toCsv([
  ['Авто', 'Тип запису', 'Дата', 'На що', 'Сума, грн', 'Джерело', 'Особа (ДеЮре)', 'Статус оплати', 'Документ'],
  ...items.map(f => [f.vehicle_id, f.scope, f.spent_on, f.purpose, f.amount, f.source, f.person_dejure, f.pay_status, f.doc_ref]),
]);

export function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
}
