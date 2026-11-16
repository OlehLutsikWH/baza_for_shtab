// Реалізація BaseApi поверх supabase-js. Права забезпечує RLS у базі, а не цей код:
// тут лише запити. Перевіряється на живій базі під час інтеграції (див. INTEGRATION.md).
import type { SupabaseClient } from '@supabase/supabase-js';
import type { NewJob, NewPart, BaseApi, Role, StatusPatch, Vehicle, VehicleDetail, VehicleSummary, Job, Part, FinanceItem, DocumentItem } from './types';

function check<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return (res.data ?? []) as T;
}

export function createSupabaseApi(sb: SupabaseClient): BaseApi {
  let roleCache: Promise<Role> | null = null;
  const role = () => (roleCache ??= (async () => {
    const r = await sb.rpc('is_head');
    return r.data === true ? 'head' : 'member';
  })());

  return {
    role,
    async statuses() {
      const r = check(await sb.from('base_ref_values').select('value').eq('kind', 'vehicle_status').order('sort'), 'Статуси');
      return (r as { value: string }[]).map(x => x.value);
    },
    async listVehicles(): Promise<VehicleSummary[]> {
      const [vs, jobs, parts] = await Promise.all([
        sb.from('base_vehicles').select('*').order('id'),
        sb.from('base_jobs').select('vehicle_id').neq('status', 'Завершено'),
        sb.from('base_parts').select('vehicle_id').eq('status', 'Замовлено'),
      ]);
      const count = (rows: { vehicle_id: string }[]) => rows.reduce<Record<string, number>>((a, r) => ((a[r.vehicle_id] = (a[r.vehicle_id] ?? 0) + 1), a), {});
      const oj = count(check(jobs, 'Роботи')), pg = count(check(parts, 'Запчастини'));
      return (check(vs, 'Авто') as Vehicle[]).map(v => ({ ...v, open_jobs: oj[v.id] ?? 0, parts_to_get: pg[v.id] ?? 0 }));
    },
    async getVehicleDetail(id): Promise<VehicleDetail | null> {
      const v = await sb.from('base_vehicles').select('*').eq('id', id).maybeSingle();
      if (v.error) throw new Error(`Авто: ${v.error.message}`);
      if (!v.data) return null;
      const isHead = (await role()) === 'head';
      const [jobs, parts, docs, fin] = await Promise.all([
        sb.from('base_jobs_v').select('*').eq('vehicle_id', id).order('started_on', { ascending: false, nullsFirst: true }),
        sb.from('base_parts').select('*').eq('vehicle_id', id).order('ordered_on', { ascending: false, nullsFirst: true }),
        sb.from('base_documents').select('*').eq('vehicle_id', id).order('doc_date', { ascending: false, nullsFirst: false }),
        isHead ? sb.from('base_finance').select('*').eq('vehicle_id', id).order('spent_on', { ascending: false, nullsFirst: false }) : Promise.resolve(null),
      ]);
      return {
        vehicle: v.data as Vehicle, jobs: check(jobs, 'Роботи') as Job[], parts: check(parts, 'Запчастини') as Part[],
        documents: check(docs, 'Документи') as DocumentItem[],
        finance: fin ? (check(fin, 'Фінанси') as FinanceItem[]) : null,
      };
    },
    async listFinance() {
      if ((await role()) !== 'head') return null;
      return check(await sb.from('base_finance').select('*').order('spent_on', { ascending: false, nullsFirst: false }), 'Фінанси') as FinanceItem[];
    },
    async signedUrl(path: string) {
      const r = await sb.storage.from('base-files').createSignedUrl(path, 300);
      if (r.error || !r.data) throw new Error(`Файл: ${r.error?.message ?? 'немає доступу'}`);
      return r.data.signedUrl;
    },
    async addJob(i: NewJob): Promise<Job> {
      const r = await sb.from('base_jobs').insert({ status: 'Заплановано', ...i }).select('*').single();
      if (r.error) throw new Error(`Додавання роботи: ${r.error.message}`);
      return { ...(r.data as Job), duration_days: null };
    },
    async addPart(i: NewPart): Promise<Part> {
      const r = await sb.from('base_parts').insert({ status: 'Замовлено', ...i }).select('*').single();
      if (r.error) throw new Error(`Додавання запчастини: ${r.error.message}`);
      return r.data as Part;
    },
    async updateVehicleStatus(id, patch: StatusPatch): Promise<Vehicle> {
      const r = await sb.from('base_vehicles').update(patch).eq('id', id).select('*').single();
      if (r.error) throw new Error(`Збереження: ${r.error.message}`);
      return r.data as Vehicle;
    },
  };
}
