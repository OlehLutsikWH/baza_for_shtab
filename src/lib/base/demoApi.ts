import type { DonorReportPatch, DonorReportRow, NewJob, NewPart, Job, Part, BaseApi, Role, StatusPatch, Vehicle, VehicleDetail, VehicleSummary } from './types';
import { demoData, draftReport } from './demoData';
import { FINAL_STATUSES } from './format';
import { demoVehiclePhotos } from './demoPhotos';

export type DemoStore = ReturnType<typeof demoData>;

/** Демо-реалізація в пам'яті: для окремої розробки й тестів.
 *  `store` можна передати спільним, щоб зміни не губились при перемиканні ролі. */
export function createDemoApi(role: Role = 'head', now: () => Date = () => new Date(), store?: DemoStore): BaseApi {
  const d = store ?? demoData(now());
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
    async listVehiclePhotos(vehicleId) {
      const v = d.vehicles.find(x => x.id === vehicleId);
      return v ? demoVehiclePhotos(v.id, v.name) : { folder: null, photos: [] };
    },
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
      // як тригер base_vehicle_report_draft: ремонт завершено → чернетка звіту
      if (FINAL_STATUSES.includes(d.vehicles[i].status) && !d.reports.some(r => r.vehicle_id === id)) d.reports.push(draftReport(id));
      return d.vehicles[i];
    },

    async getDonorReport(vehicleId) {
      if (role !== 'head') return null;
      const r = d.reports.find(x => x.vehicle_id === vehicleId);
      return r ? { ...r } : null;
    },
    async saveDonorReport(vehicleId, patch: DonorReportPatch): Promise<DonorReportRow> {
      if (role !== 'head') throw new Error('Звіти доступні лише керівникам');
      if (!d.vehicles.some(v => v.id === vehicleId)) throw new Error('Авто не знайдено');
      let i = d.reports.findIndex(x => x.vehicle_id === vehicleId);
      if (i < 0) { d.reports.push(draftReport(vehicleId)); i = d.reports.length - 1; }
      d.reports[i] = { ...d.reports[i], ...patch };
      return { ...d.reports[i] };
    },
    async setFinanceCategory(financeId, category) {
      if (role !== 'head') throw new Error('Фінанси доступні лише керівникам');
      const f = d.finance.find(x => x.id === financeId);
      if (!f) throw new Error('Витрату не знайдено');
      f.category = category;
    },
    async storeReportPdf(vehicleId, file, filename): Promise<DonorReportRow> {
      if (role !== 'head') throw new Error('Звіти доступні лише керівникам');
      if (!(file.size > 0)) throw new Error('Порожній файл звіту');
      if (!d.vehicles.some(v => v.id === vehicleId)) throw new Error('Авто не знайдено');
      let i = d.reports.findIndex(x => x.vehicle_id === vehicleId);
      if (i < 0) { d.reports.push(draftReport(vehicleId)); i = d.reports.length - 1; }
      d.reports[i] = { ...d.reports[i], status: 'Сформовано', storage_path: `demo:finance/reports/${vehicleId}/${filename}`, generated_at: now().toISOString() };
      return { ...d.reports[i] };
    },
    async listPendingReports() {
      if (role !== 'head') return null;
      return d.reports.filter(r => r.status === 'Чернетка')
        .map(r => { const v = d.vehicles.find(x => x.id === r.vehicle_id)!; return { vehicle_id: v.id, name: v.name, status: v.status }; });
    },
  };
}
