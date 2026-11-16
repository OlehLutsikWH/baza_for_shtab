import type { Vehicle, VehicleSummary, Job, Part, FinanceItem } from './types';

const money = new Intl.NumberFormat('uk-UA', { style: 'currency', currency: 'UAH', maximumFractionDigits: 2 });
export const formatMoney = (n: number | null | undefined) => (n == null ? '—' : money.format(n).replace(/ /g, ' '));

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
}

/** Повних діб від `iso` до `now`. */
export function daysSince(iso: string, now: Date): number {
  return Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000);
}

export function ageLabel(iso: string, now: Date): string {
  const d = daysSince(iso, now);
  if (d <= 0) return 'сьогодні';
  if (d === 1) return 'вчора';
  const last = d % 10, tail = d % 100;
  const word = last === 1 && tail !== 11 ? 'день' : last >= 2 && last <= 4 && (tail < 12 || tail > 14) ? 'дні' : 'днів';
  return `${d} ${word} тому`;
}

/** Статуси, після яких оновлювати нема чого. */
export const FINAL_STATUSES = ['Готовий', 'Передано частині'];
export const STALE_AFTER_DAYS = 7;

/** «Давно не оновлювалось»: авто в роботі, а статус не чіпали ≥ N днів. */
export function isStale(v: Pick<Vehicle, 'status' | 'status_updated_at'>, now: Date, days = STALE_AFTER_DAYS): boolean {
  return !FINAL_STATUSES.includes(v.status) && daysSince(v.status_updated_at, now) >= days;
}

export interface ListFilter { query: string; status: string; unit: string; onlyBlocked: boolean; onlyStale: boolean }
export const EMPTY_FILTER: ListFilter = { query: '', status: '', unit: '', onlyBlocked: false, onlyStale: false };

const norm = (s: string | null | undefined) => (s ?? '').toLocaleLowerCase('uk').replace(/[\s\-]+/g, '');

export function filterVehicles(list: VehicleSummary[], f: ListFilter, now: Date): VehicleSummary[] {
  const q = norm(f.query);
  return list.filter(v => {
    if (f.status && v.status !== f.status) return false;
    if (f.unit && v.military_unit !== f.unit) return false;
    if (f.onlyBlocked && !v.blocker) return false;
    if (f.onlyStale && !isStale(v, now)) return false;
    if (q) {
      const hay = [v.id, v.name, v.vin, v.plate, v.military_unit, v.requested_by].map(norm).join('|');
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/** Спершу авто, що потребують уваги (блокер, застарілий статус), потім за номером. */
export function sortForAttention(list: VehicleSummary[], now: Date): VehicleSummary[] {
  const rank = (v: VehicleSummary) => (FINAL_STATUSES.includes(v.status) ? 3 : v.blocker ? 0 : isStale(v, now) ? 1 : 2);
  return [...list].sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
}

export const jobDuration = (j: Pick<Job, 'status' | 'started_on' | 'finished_on'>): number | null =>
  j.status === 'Завершено' && j.started_on && j.finished_on
    ? Math.round((Date.parse(j.finished_on) - Date.parse(j.started_on)) / 86_400_000) : null;

/** Запчастини, які ще треба отримати. */
export const partsToGet = (parts: Pick<Part, 'status'>[]) => parts.filter(p => p.status === 'Замовлено');

export function financeTotals(items: Pick<FinanceItem, 'amount' | 'pay_status'>[]) {
  const sum = (f: (i: { amount: number; pay_status: string }) => boolean) => items.filter(f).reduce((s, i) => s + i.amount, 0);
  return { total: sum(() => true), paid: sum(i => i.pay_status === 'Оплачено'), pending: sum(i => i.pay_status === 'Очікує оплати') };
}
