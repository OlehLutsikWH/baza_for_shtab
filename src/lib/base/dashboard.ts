import type { FinanceItem, VehicleSummary } from './types';
import { FINAL_STATUSES, isStale } from './format';

export interface DashboardData {
  byStatus: { status: string; count: number }[];
  total: number; active: number;
  blocked: VehicleSummary[]; stale: VehicleSummary[];
  partsWaiting: number;
  /** лише для керівників (finance !== null) */
  money: null | { pending: number; pendingUnattributed: number; debtors: { person: string; amount: number }[] };
}

export function buildDashboard(list: VehicleSummary[], statuses: string[], finance: FinanceItem[] | null, now: Date): DashboardData {
  const active = list.filter(v => !FINAL_STATUSES.includes(v.status));
  const count = (s: string) => list.filter(v => v.status === s).length;
  const known = statuses.map(s => ({ status: s, count: count(s) }));
  const extra = [...new Set(list.map(v => v.status))].filter(s => !statuses.includes(s)).map(s => ({ status: s, count: count(s) }));
  let money: DashboardData['money'] = null;
  if (finance) {
    const pend = finance.filter(f => f.pay_status === 'Очікує оплати');
    const by = new Map<string, number>();
    for (const f of pend) if (f.person_dejure) by.set(f.person_dejure, (by.get(f.person_dejure) ?? 0) + f.amount);
    money = {
      pending: pend.reduce((a, f) => a + f.amount, 0),
      pendingUnattributed: pend.filter(f => !f.person_dejure).reduce((a, f) => a + f.amount, 0),
      debtors: [...by].map(([person, amount]) => ({ person, amount })).sort((a, b) => b.amount - a.amount),
    };
  }
  return {
    byStatus: [...known, ...extra], total: list.length, active: active.length,
    blocked: active.filter(v => v.blocker), stale: active.filter(v => isStale(v, now)),
    partsWaiting: list.reduce((a, v) => a + v.parts_to_get, 0), money,
  };
}
