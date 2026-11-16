import type { NewJob, NewPart, Job, Part, BaseApi, Role, StatusPatch, Vehicle, VehicleDetail, VehicleSummary } from './types';
import { demoData } from './demoData';

/** Демо-реалізація в пам'яті: для окремої розробки й тестів. */
export function createDemoApi(role: Role = 'head', now: () => Date = () => new Date()): BaseApi {
  const d = demoData(now());
  return {
    role: async () => role,
    statuses: async () => d.statuses,
    async listVehicles(): Promise<VehicleSummary[]> {
      return d.vehicles.map(v => ({
        ...v,
        open_jobs: d.jobs.filter(j => j.vehicle_id === v.id && j.status !== 'Завершено').length,
        parts_to_get: d.parts.filter(p => p.vehicle_id === v.id && p.status === 'Замовлено').length,
      }));
    },
    async getVehicleDetail(id): Promise<VehicleDetail | null> {
      const vehicle = d.vehicles.find(v => v.id === id);
      if (!vehicle) return null;
      return {
        vehicle, jobs: d.jobs.filter(j => j.vehicle_id === id), parts: d.parts.filter(p => p.vehicle_id === id),
        documents: d.documents.filter(x => x.vehicle_id === id),
        finance: role === 'head' ? d.finance.filter(f => f.vehicle_id === id) : null,
      };
    },
    async listFinance() { return role === 'head' ? [...d.finance] : null; },
    async signedUrl(path: string) { return `#demo-file:${encodeURIComponent(path)}`; },
    async addJob(i: NewJob): Promise<Job> {
      if (role !== 'head') throw new Error('Додавати записи можуть лише керівники');
      if (!d.vehicles.some(v => v.id === i.vehicle_id)) throw new Error('Авто не знайдено');
      const j: Job = { id: Math.max(0, ...d.jobs.map(x => x.id)) + 1, vehicle_id: i.vehicle_id, nomenclature_id: null, description: i.description,
        executor: i.executor ?? null, location: i.location ?? null, status: i.status ?? 'Заплановано', started_on: null, finished_on: null, notes: i.notes ?? null, duration_days: null };
      d.jobs.push(j); return j;
    },
    async addPart(i: NewPart): Promise<Part> {
      if (role !== 'head') throw new Error('Додавати записи можуть лише керівники');
      if (!d.vehicles.some(v => v.id === i.vehicle_id)) throw new Error('Авто не знайдено');
      const p: Part = { id: Math.max(0, ...d.parts.map(x => x.id)) + 1, vehicle_id: i.vehicle_id, name: i.name, qty: i.qty, status: i.status ?? 'Замовлено',
        supplier: i.supplier ?? null, cost_total: null, ordered_on: null, received_on: null, notes: i.notes ?? null };
      d.parts.push(p); return p;
    },
    async updateVehicleStatus(id, patch: StatusPatch): Promise<Vehicle> {
      if (role !== 'head') throw new Error('Змінювати статус можуть лише керівники');
      const i = d.vehicles.findIndex(v => v.id === id);
      if (i < 0) throw new Error('Авто не знайдено');
      d.vehicles[i] = { ...d.vehicles[i], ...patch, status_updated_at: now().toISOString() };
      return d.vehicles[i];
    },
  };
}
