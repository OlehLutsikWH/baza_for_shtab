// Сховище бота в пам'яті — для тестів і демо. Справжнє — store-supabase.ts.
import type { BotStore, BotUser, BotVehicle, PendingPayment, PendingReport, WaitingPart } from './core.ts';

export interface MemoryData {
  vehicles: BotVehicle[]; parts: WaitingPart[]; payments: PendingPayment[]; reports: PendingReport[];
  money: Record<string, { total: number; pending: number }>; statuses: string[]; users: BotUser[];
  /** що відбувається з чернетками звітів, коли статус стає фінальним (як тригер у базі) */
  onFinal?: (vehicleId: string) => void;
}

export function createMemoryStore(d: MemoryData, clock: () => number = () => Date.now()) {
  const log = new Set<string>();
  const calls: { setStatus: [string, string][]; confirm: string[] } = { setStatus: [], confirm: [] };
  const store: BotStore = {
    vehicles: async () => d.vehicles.map(v => ({ ...v })),
    waitingParts: async () => [...d.parts],
    pendingPayments: async () => [...d.payments],
    pendingReports: async () => [...d.reports],
    vehicleMoney: async id => d.money[id] ?? { total: 0, pending: 0 },
    statuses: async () => [...d.statuses],
    async setStatus(id, status) {
      calls.setStatus.push([id, status]);
      const v = d.vehicles.find(x => x.id === id);
      if (!v) throw new Error('Авто не знайдено');
      v.status = status; v.status_updated_at = new Date(clock()).toISOString();
      if (['Готовий', 'Передано частині'].includes(status)) d.onFinal?.(id);
    },
    async confirmNoChange(id) {
      calls.confirm.push(id);
      const v = d.vehicles.find(x => x.id === id);
      if (v) v.status_updated_at = new Date(clock()).toISOString();
    },
    users: async () => d.users.map(u => ({ ...u })),
    async upsertUser(u) { d.users = [...d.users.filter(x => x.telegram_id !== u.telegram_id), u]; },
    async removeUser(id) { d.users = d.users.filter(x => x.telegram_id !== id); },
    wasSent: async (k, r) => log.has(`${k}|${r}`),
    markSent: async (k, r) => { log.add(`${k}|${r}`); },
  };
  return { store, calls, log };
}
