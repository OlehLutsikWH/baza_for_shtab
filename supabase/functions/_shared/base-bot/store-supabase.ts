// Сховище бота поверх supabase-js з ключем service role (бот діє від імені системи, повз RLS;
// хто що бачить — вирішує ядро бота за роллю користувача Telegram).
import type { BotStore, BotUser, BotVehicle, PendingPayment, PendingReport, WaitingPart } from './core.ts';

type Res<T> = PromiseLike<{ data: T | null; error: { message: string } | null }>;
// мінімальний тип клієнта, щоб файл не залежав від версії supabase-js
// deno-lint-ignore no-explicit-any
type SB = { from(t: string): any };

async function q<T>(p: Res<T>, what: string): Promise<T> {
  const r = await p;
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return (r.data ?? []) as T;
}
const cents = (n: number) => Math.round(Number(n) * 100);

export function createSupabaseBotStore(sb: SB): BotStore {
  return {
    async vehicles() {
      const [vs, jobs, parts] = await Promise.all([
        q<Omit<BotVehicle, 'open_jobs' | 'parts_waiting'>[]>(sb.from('base_vehicles').select('id, name, status, blocker, next_step, responsible, status_updated_at, military_unit').order('id'), 'Авто'),
        q<{ vehicle_id: string }[]>(sb.from('base_jobs').select('vehicle_id').neq('status', 'Завершено'), 'Роботи'),
        q<{ vehicle_id: string }[]>(sb.from('base_parts').select('vehicle_id').eq('status', 'Замовлено'), 'Запчастини'),
      ]);
      const count = (rows: { vehicle_id: string }[]) => rows.reduce<Record<string, number>>((a, r) => ((a[r.vehicle_id] = (a[r.vehicle_id] ?? 0) + 1), a), {});
      const oj = count(jobs), pw = count(parts);
      return vs.map(v => ({ ...v, open_jobs: oj[v.id] ?? 0, parts_waiting: pw[v.id] ?? 0 }));
    },
    waitingParts: () => q<WaitingPart[]>(sb.from('base_parts').select('vehicle_id, name, qty, ordered_on').eq('status', 'Замовлено'), 'Запчастини'),
    async pendingPayments() {
      const rows = await q<PendingPayment[]>(sb.from('base_finance').select('vehicle_id, amount, spent_on, purpose').eq('pay_status', 'Очікує оплати'), 'Фінанси');
      return rows.map(r => ({ ...r, amount: Number(r.amount) }));
    },
    pendingReports: () => q<PendingReport[]>(sb.from('base_reports_pending').select('vehicle_id, name, created_at').order('created_at'), 'Звіти'),
    async vehicleMoney(id) {
      const rows = await q<{ amount: number; pay_status: string }[]>(sb.from('base_finance').select('amount, pay_status').eq('vehicle_id', id), 'Фінанси');
      return {
        total: rows.reduce((a, r) => a + cents(r.amount), 0) / 100,
        pending: rows.filter(r => r.pay_status === 'Очікує оплати').reduce((a, r) => a + cents(r.amount), 0) / 100,
      };
    },
    async statuses() {
      const rows = await q<{ value: string }[]>(sb.from('base_ref_values').select('value').eq('kind', 'vehicle_status').order('sort'), 'Статуси');
      return rows.map(r => r.value);
    },
    async setStatus(id, status) { await q(sb.from('base_vehicles').update({ status }).eq('id', id).select('id'), 'Статус'); },
    async confirmNoChange(id) { await q(sb.from('base_vehicles').update({ status_updated_at: new Date().toISOString() }).eq('id', id).select('id'), 'Статус'); },
    async users() {
      const rows = await q<BotUser[]>(sb.from('base_bot_users').select('telegram_id, name, role, notify'), 'Користувачі бота');
      return rows.map(u => ({ ...u, telegram_id: Number(u.telegram_id) }));
    },
    async upsertUser(u) { await q(sb.from('base_bot_users').upsert(u, { onConflict: 'telegram_id' }).select('telegram_id'), 'Користувачі бота'); },
    async removeUser(id) { await q(sb.from('base_bot_users').delete().eq('telegram_id', id).select('telegram_id'), 'Користувачі бота'); },
    async wasSent(kind, ref) {
      const rows = await q<unknown[]>(sb.from('base_bot_log').select('kind').eq('kind', kind).eq('ref', ref).limit(1), 'Журнал бота');
      return rows.length > 0;
    },
    async markSent(kind, ref) { await q(sb.from('base_bot_log').upsert({ kind, ref }, { onConflict: 'kind,ref' }).select('kind'), 'Журнал бота'); },
  };
}
