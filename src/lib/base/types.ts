export type Role = 'head' | 'member';

export interface LegacyLink { field: string; url: string; text?: string }

export interface Vehicle {
  id: string; name: string; vehicle_type: string | null; vin: string | null; plate: string | null;
  status: string; requested_by: string | null; military_unit: string | null; purpose: string | null;
  received_on: string | null; handed_over_on: string | null; notes: string | null;
  blocker: string | null; next_step: string | null; responsible: string | null;
  status_updated_at: string; legacy_links: LegacyLink[] | null;
}
export interface Job {
  id: number; vehicle_id: string; nomenclature_id: string | null; description: string | null; executor: string | null;
  location: string | null; status: string; started_on: string | null; finished_on: string | null; notes: string | null;
  duration_days: number | null;
}
export interface Part {
  id: number; vehicle_id: string; name: string; qty: number; status: string; supplier: string | null;
  cost_total: number | null; ordered_on: string | null; received_on: string | null; notes: string | null;
}
export interface FinanceItem {
  id: number; vehicle_id: string | null; scope: string; amount: number; spent_on: string | null; purpose: string | null;
  doc_ref: string | null; source: string | null; person_dejure: string | null; pay_status: string; paid_on: string | null;
  legacy_links: LegacyLink[] | null;
}
export interface DocumentItem {
  id: number; vehicle_id: string; doc_type: string | null; storage_path: string | null; legacy_links: LegacyLink[] | null;
  doc_date: string | null; notes: string | null;
}

/** Рядок списку: авто + короткі лічильники для команди. */
export interface VehicleSummary extends Vehicle { open_jobs: number; parts_to_get: number }

export interface VehicleDetail {
  vehicle: Vehicle; jobs: Job[]; parts: Part[]; documents: DocumentItem[];
  /** null для не-керівників: фінанси їм недоступні */
  finance: FinanceItem[] | null;
}

export interface StatusPatch { status?: string; blocker?: string | null; next_step?: string | null; responsible?: string | null }

export interface NewJob { vehicle_id: string; description: string; executor?: string | null; location?: string | null; status?: string; notes?: string | null }
export interface NewPart { vehicle_id: string; name: string; qty: number; supplier?: string | null; status?: string; notes?: string | null }

export interface BaseApi {
  role(): Promise<Role>;
  statuses(): Promise<string[]>;
  listVehicles(): Promise<VehicleSummary[]>;
  getVehicleDetail(id: string): Promise<VehicleDetail | null>;
  updateVehicleStatus(id: string, patch: StatusPatch): Promise<Vehicle>;
  /** Усі фінансові записи; null для не-керівників. */
  listFinance(): Promise<FinanceItem[] | null>;
  /** Запис роботи/запчастини — лише керівники (припущення, див. README). */
  /** Тимчасове посилання на файл у bucket base-files (діє за політиками Storage). */
  signedUrl(path: string): Promise<string>;
  addJob(input: NewJob): Promise<Job>;
  addPart(input: NewPart): Promise<Part>;
}
