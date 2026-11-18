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
  /** Стаття витрати з довідника finance_category; null — ще не вказано */
  category: string | null;
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

/** vehicle — до однієї машини; shared — спільний на кілька авто; general — не про авто (оренда СТО тощо). */
export type PaymentTarget = { scope: 'vehicle'; vehicle_id: string } | { scope: 'shared' | 'general' };

export interface StatusPatch { status?: string; blocker?: string | null; next_step?: string | null; responsible?: string | null }

export interface NewJob { vehicle_id: string; description: string; executor?: string | null; location?: string | null; status?: string; notes?: string | null }
export interface NewPart { vehicle_id: string; name: string; qty: number; supplier?: string | null; status?: string; notes?: string | null }

/** Фото для звіту: «drive:<id файлу>» (фото з Google Drive), підпис і «до»/«після». */
export interface ReportPhoto { path: string; caption?: string | null; kind?: 'до' | 'після' | null }

/** Фото авто з Google Drive (функція base-drive «Штабу»). thumb/full — тимчасові посилання (~1 год). */
export interface DrivePhoto { id: string; name: string; mimeType: string; takenAt: string | null; group: string | null; thumb: string; full: string }
export interface VehiclePhotos { folder: { id: string; name: string; url: string | null } | null; photos: DrivePhoto[]; truncated?: boolean }

/** Те, що керівник дописав до звіту для донорів (таблиця base_donor_reports). */
export interface DonorReportRow {
  vehicle_id: string;
  status: 'Чернетка' | 'Сформовано';
  story: string | null;
  thanks: string | null;
  unit_label: string | null;
  show_unit: boolean;
  show_invoices: boolean;
  /** id витрати → як цей рахунок назвати для донорів */
  row_labels: Record<string, string>;
  photo_paths: ReportPhoto[];
  storage_path: string | null;
  generated_at: string | null;
}
export type DonorReportPatch = Partial<Pick<DonorReportRow,
  'story' | 'thanks' | 'unit_label' | 'show_unit' | 'show_invoices' | 'row_labels' | 'photo_paths'>>;
export interface PendingReport { vehicle_id: string; name: string; status: string }

export interface BaseApi {
  role(): Promise<Role>;
  statuses(): Promise<string[]>;
  listVehicles(): Promise<VehicleSummary[]>;
  getVehicleDetail(id: string): Promise<VehicleDetail | null>;
  updateVehicleStatus(id: string, patch: StatusPatch): Promise<Vehicle>;
  /** Усі фінансові записи; null для не-керівників. */
  listFinance(): Promise<FinanceItem[] | null>;
  /** Куди віднести платіж без авто: до машини, спільний (на кілька авто) чи не про авто — лише керівники. */
  assignPayment(financeId: number, target: PaymentTarget): Promise<void>;
  /** Тимчасове посилання на файл у bucket base-files (діє за політиками Storage). */
  signedUrl(path: string): Promise<string>;
  /** Запис роботи/запчастини — лише керівники «Бази» (рішення Олега 18.11.2026, див. README). */
  addJob(input: NewJob): Promise<Job>;
  /** Фото авто з його папки «АВТО-0XX …» на Google Drive (бачать усі члени команди). */
  listVehiclePhotos(vehicleId: string): Promise<VehiclePhotos>;
  addPart(input: NewPart): Promise<Part>;

  // ---- Звіт для донорів (лише керівники) ----
  /** Чернетка/звіт по авто; null — звіту ще немає або немає прав. */
  getDonorReport(vehicleId: string): Promise<DonorReportRow | null>;
  saveDonorReport(vehicleId: string, patch: DonorReportPatch): Promise<DonorReportRow>;
  setFinanceCategory(financeId: number, category: string | null): Promise<void>;
  /** Зберегти сформований PDF (Storage finance/reports/…) і позначити звіт «Сформовано». */
  storeReportPdf(vehicleId: string, file: Blob, filename: string): Promise<DonorReportRow>;
  /** Завершені авто, по яких звіт ще чернетка; null для не-керівників. */
  listPendingReports(): Promise<PendingReport[] | null>;
}
