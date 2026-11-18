// Сховище бота в пам'яті — для тестів і демо. Справжнє — store-supabase.ts.
import type { BotDraft, BotStore, BotUpload, BotUser, BotVehicle, PendingPayment, PendingReport, WaitingPart } from './core.ts';

export interface MemoryData {
  vehicles: BotVehicle[]; parts: WaitingPart[]; payments: PendingPayment[]; reports: PendingReport[];
  money: Record<string, { total: number; pending: number }>; statuses: string[]; users: BotUser[];
  /** що відбувається з чернетками звітів, коли статус стає фінальним (як тригер у базі) */
  onFinal?: (vehicleId: string) => void;
}

export function createMemoryStore(d: MemoryData, clock: () => number = () => Date.now()) {
  const log = new Set<string>();
  const uploads: BotUpload[] = [];
  const drafts: BotDraft[] = [];
  const jobs: { id: number; vehicle_id: string; description: string; status: string }[] = [];
  const parts: { id: number; vehicle_id: string; name: string; qty: number; cost_total: number | null; status: string; ordered_on: string }[] = [];
  let seq = 0;
  /** для тестів: наступна вставка роботи/запчастини впаде з цією помилкою */
  const fail: { next: string | null } = { next: null };
  const iso = () => new Date(clock()).toISOString();
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
      v.status = status; v.status_updated_at = iso();
      if (['Готовий', 'Передано частині'].includes(status)) d.onFinal?.(id);
    },
    async confirmNoChange(id) {
      calls.confirm.push(id);
      const v = d.vehicles.find(x => x.id === id);
      if (v) v.status_updated_at = iso();
    },
    users: async () => d.users.map(u => ({ ...u })),
    async upsertUser(u) { d.users = [...d.users.filter(x => x.telegram_id !== u.telegram_id), u]; },
    async removeUser(id) { d.users = d.users.filter(x => x.telegram_id !== id); },
    wasSent: async (k, r) => log.has(`${k}|${r}`),
    markSent: async (k, r) => { log.add(`${k}|${r}`); },
    async claim(k, r) {
      if (log.has(`${k}|${r}`)) return false;
      log.add(`${k}|${r}`);
      return true;
    },
    async addUpload(u) {
      if (uploads.some(x => x.chat_id === u.chat_id && x.message_id === u.message_id)) return null;
      const row: BotUpload = { ...u, id: ++seq, status: 'pending', vehicle_id: null, kind: null, drive_file_id: null, error: null, updated_at: iso() };
      uploads.push(row);
      return { ...row };
    },
    async uploadGroup(id) {
      const r = uploads.find(x => x.id === id);
      if (!r) return [];
      const group = r.media_group_id ? uploads.filter(x => x.chat_id === r.chat_id && x.media_group_id === r.media_group_id) : [r];
      return group.map(x => ({ ...x })).sort((a, b) => a.id - b.id);
    },
    async claimUploads(ids, staleBefore) {
      const out: number[] = [];
      for (const x of uploads) {
        if (!ids.includes(x.id)) continue;
        if (x.status === 'pending' || (x.status === 'saving' && x.updated_at < staleBefore)) {
          x.status = 'saving'; x.updated_at = iso(); x.error = null; out.push(x.id);
        }
      }
      return out;
    },
    async updateUploads(ids, patch, onlyIfStatus) {
      for (const x of uploads) if (ids.includes(x.id) && (!onlyIfStatus || x.status === onlyIfStatus)) Object.assign(x, patch, { updated_at: iso() });
    },
    async addDraft(dr) {
      const row: BotDraft = { ...dr, payload: { ...dr.payload }, id: ++seq, status: 'pending', record_id: null, created_at: iso() };
      drafts.push(row);
      return { ...row };
    },
    getDraft: async id => { const r = drafts.find(x => x.id === id); return r ? { ...r } : null; },
    async moveDraft(id, from, patch) {
      const r = drafts.find(x => x.id === id && x.status === from);
      if (!r) return null;
      Object.assign(r, patch);
      return { ...r };
    },
    async addJob(vehicle_id, description) {
      if (fail.next) { const m = fail.next; fail.next = null; throw new Error(m); }
      const j = { id: ++seq, vehicle_id, description, status: 'Заплановано' };
      jobs.push(j);
      return { id: j.id };
    },
    async addPart(vehicle_id, name, qty, cost_total, ordered_on) {
      if (fail.next) { const m = fail.next; fail.next = null; throw new Error(m); }
      const p = { id: ++seq, vehicle_id, name, qty, cost_total, status: 'Замовлено', ordered_on };
      parts.push(p);
      return { id: p.id };
    },
  };
  return { store, calls, log, uploads, drafts, jobs, parts, fail };
}
