'use client';
// Звіт для донорів у картці завершеного авто (лише керівник): дописати історію й подяку,
// перевірити статті та підписи витрат, обрати фото, сформувати PDF.
import { useEffect, useMemo, useState } from 'react';
import { useBaseApi } from '../../lib/base/context';
import type { DonorReportPatch, DonorReportRow, FinanceItem, ReportPhoto, VehicleDetail, VehiclePhotos } from '../../lib/base/types';
import { buildDonorReport, money, dateUa, type ReportImage } from '../../lib/base/report/model';
import { FINANCE_CATEGORIES, categoryOf } from '../../lib/base/report/categories';
import { BRAND } from '../../lib/base/report/brand';
import { drivePath, driveIdOf, kindFromGroup } from '../../lib/base/photos';
import { saveFile } from '../../lib/base/files';

interface Form {
  story: string; thanks: string; unit_label: string; show_unit: boolean; show_invoices: boolean;
  row_labels: Record<string, string>; photo_paths: ReportPhoto[];
}
const toForm = (r: DonorReportRow): Form => ({
  story: r.story ?? '', thanks: r.thanks ?? '', unit_label: r.unit_label ?? '', show_unit: r.show_unit, show_invoices: r.show_invoices,
  row_labels: { ...r.row_labels }, photo_paths: [...r.photo_paths],
});
const toPatch = (f: Form): DonorReportPatch => ({
  story: f.story.trim() || null, thanks: f.thanks.trim() || null, unit_label: f.unit_label.trim() || null,
  show_unit: f.show_unit, show_invoices: f.show_invoices,
  row_labels: Object.fromEntries(Object.entries(f.row_labels).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v)),
  photo_paths: f.photo_paths,
});

export function DonorReportPanel({ detail, now }: { detail: VehicleDetail; now: Date }) {
  const api = useBaseApi();
  const v = detail.vehicle;
  const [report, setReport] = useState<DonorReportRow | null | undefined>(undefined);
  const [form, setForm] = useState<Form | null>(null);
  const [finance, setFinance] = useState<FinanceItem[]>(detail.finance ?? []);
  const [shared, setShared] = useState(0);
  const [drive, setDrive] = useState<VehiclePhotos | null>(null);
  const [driveError, setDriveError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | 'save' | 'draft' | 'final' | 'create'>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let off = false;
    Promise.all([api.getDonorReport(v.id), api.listFinance()])
      .then(([r, all]) => {
        if (off) return;
        setReport(r); setForm(r ? toForm(r) : null);
        setShared((all ?? []).filter(f => f.scope === 'shared').length);
      })
      .catch(e => { if (!off) { setReport(null); setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }); } });
    api.listVehiclePhotos(v.id)
      .then(r => { if (!off) setDrive(r); })
      .catch(e => { if (!off) setDriveError(e instanceof Error ? e.message : String(e)); });
    return () => { off = true; };
  }, [api, v.id]);

  const partNames = useMemo(() => detail.parts.map(p => p.name), [detail.parts]);
  const model = useMemo(() => {
    if (!report || !form) return null;
    const images: ReportImage[] = form.photo_paths.map(p => ({ src: '', caption: p.caption ?? null, kind: p.kind ?? null }));
    return buildDonorReport({ vehicle: v, jobs: detail.jobs, parts: detail.parts, finance, report: { ...report, ...toPatch(form) } as DonorReportRow,
      now, images, sharedUnallocated: shared });
  }, [report, form, v, detail.jobs, detail.parts, finance, now, shared]);

  if (report === undefined) return <p className="base-muted">Завантаження звіту…</p>;
  if (!report || !form || !model) {
    return (
      <section className="base-report" aria-label="Звіт для донорів">
        <p className="base-muted">Чернетка звіту з'являється автоматично, коли ремонт завершено. Для цього авто її ще немає.</p>
        <div className="base-actions">
          <button type="button" disabled={busy !== null} onClick={async () => {
            setBusy('create'); setMsg(null);
            try { const r = await api.saveDonorReport(v.id, {}); setReport(r); setForm(toForm(r)); }
            catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }); }
            finally { setBusy(null); }
          }}>Створити чернетку звіту</button>
          {msg && <span role="alert" className="base-error">{msg.text}</span>}
        </div>
      </section>
    );
  }

  const set = (patch: Partial<Form>) => setForm({ ...form, ...patch });
  const autoStory = buildDonorReport({ vehicle: v, jobs: detail.jobs, parts: detail.parts, finance, report: { ...report, story: null } as DonorReportRow, now })
    .story.paragraphs.join('\n\n');

  async function save(): Promise<DonorReportRow> {
    const r = await api.saveDonorReport(v.id, toPatch(form!));
    setReport(r);
    return r;
  }
  async function onSave() {
    setBusy('save'); setMsg(null);
    try { await save(); setMsg({ ok: true, text: 'Збережено' }); }
    catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(null); }
  }
  async function setCategory(f: FinanceItem, value: string) {
    const category = value || null;
    try {
      await api.setFinanceCategory(f.id, category);
      setFinance(xs => xs.map(x => (x.id === f.id ? { ...x, category } : x)));
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }); }
  }
  function togglePhoto(path: string, on: boolean, group: string | null) {
    set({ photo_paths: on ? [...form!.photo_paths, { path, kind: kindFromGroup(group), caption: null }] : form!.photo_paths.filter(p => p.path !== path) });
  }
  function patchPhoto(path: string, patch: Partial<ReportPhoto>) {
    set({ photo_paths: form!.photo_paths.map(p => (p.path === path ? { ...p, ...patch } : p)) });
  }
  async function generate(final: boolean) {
    setBusy(final ? 'final' : 'draft'); setMsg(null);
    try {
      const saved = await save();
      // посилання на фото з Drive діють ~1 год, тому беремо свіжі саме перед формуванням
      let skipped = 0;
      const images: ReportImage[] = [];
      if (saved.photo_paths.length) {
        const fresh = await api.listVehiclePhotos(v.id);
        const byId = new Map(fresh.photos.map(p => [p.id, p] as const));
        for (const p of saved.photo_paths) {
          const id = driveIdOf(p.path);
          const ph = id ? byId.get(id) : undefined;
          if (ph) images.push({ src: ph.full, caption: p.caption ?? null, kind: p.kind ?? null }); else skipped++;
        }
      }
      const m = buildDonorReport({ vehicle: v, jobs: detail.jobs, parts: detail.parts, finance, report: saved, now, images, sharedUnallocated: shared, final });
      const { renderDonorReportPdf, reportFileName } = await import('../../lib/base/report/render');
      const blob = await renderDonorReportPdf(m);
      const name = reportFileName(v.id, now, !final);
      if (final) setReport(await api.storeReportPdf(v.id, blob, name));
      await saveFile(name, blob, 'application/pdf');
      const note = skipped ? ` ${skipped} ${skipped === 1 ? 'вибране фото вже зникло' : 'вибраних фото вже зникли'} з Drive — їх пропущено.` : '';
      setMsg({ ok: true, text: (final ? `Фінальний звіт сформовано: ${name}.` : `Чернетку сформовано: ${name}.`) + note });
    } catch (e) {
      setMsg({ ok: false, text: `Не вдалося сформувати PDF: ${e instanceof Error ? e.message : String(e)}` });
    } finally { setBusy(null); }
  }

  return (
    <section className="base-report" aria-label="Звіт для донорів">
      <div className="base-report__head">
        <h2 className="base-h2">Звіт для донорів</h2>
        <span className={`base-badge ${report.status === 'Сформовано' ? 'base-badge--ok' : 'base-badge--warn'}`}>
          {report.status}{report.status === 'Сформовано' && report.generated_at ? ` · ${dateUa(report.generated_at)}` : ''}
        </span>
      </div>
      <p className="base-muted">
        Звіт складається з робіт, запчастин і витрат цього авто. VIN, держномер, імена людей, СТО й постачальників у звіт не потрапляють.
        Разом у звіті: <b>{money(model.figures.total)}</b>.
      </p>

      {model.warnings.length > 0 && (
        <div className="base-warnbox" role="note">
          <h3 className="base-h3">Перед відправленням перевірте</h3>
          <ul>{model.warnings.map(w => <li key={w}>{w}</li>)}</ul>
        </div>
      )}

      <div className="base-editor">
        <label htmlFor="rep-story">Історія машини
          <textarea id="rep-story" rows={6} value={form.story} placeholder={autoStory} onChange={e => set({ story: e.target.value })} />
        </label>
        {!form.story.trim() && (
          <button type="button" className="base-linkbtn" onClick={() => set({ story: autoStory })}>Вставити текст, складений з даних, і дописати</button>
        )}
        <label htmlFor="rep-thanks">Подяка
          <textarea id="rep-thanks" rows={3} value={form.thanks} placeholder={BRAND.defaultThanks} onChange={e => set({ thanks: e.target.value })} />
        </label>
        <label className="base-check"><input type="checkbox" id="rep-show-unit" checked={form.show_unit} onChange={e => set({ show_unit: e.target.checked })} /> Показувати підрозділ</label>
        {form.show_unit && (
          <label htmlFor="rep-unit">Як назвати підрозділ у звіті
            <input id="rep-unit" type="text" value={form.unit_label} placeholder={v.military_unit ?? 'напр. 46 ОАеМБр'} onChange={e => set({ unit_label: e.target.value })} />
          </label>
        )}
        <label className="base-check"><input type="checkbox" id="rep-show-inv" checked={form.show_invoices} onChange={e => set({ show_invoices: e.target.checked })} /> Показувати кожну витрату окремо</label>
      </div>

      <h3 className="base-h3 base-gap">Витрати у звіті</h3>
      {finance.length === 0 ? <p className="base-empty">По авто немає витрат.</p> : (
        <div className="base-table-wrap"><table className="base-table">
          <thead><tr><th scope="col">Дата</th><th scope="col" className="base-num">Сума</th><th scope="col">Стаття</th><th scope="col">Як назвати для донорів</th></tr></thead>
          <tbody>{[...finance].sort((a, b) => (a.spent_on ?? '9').localeCompare(b.spent_on ?? '9')).map(f => {
            const c = categoryOf(f, partNames);
            return (
              <tr key={f.id}>
                <td>{dateUa(f.spent_on) ?? '—'}</td>
                <td className="base-num">{money(f.amount)}{f.pay_status !== 'Оплачено' && <div className="base-stale">в процесі оплати</div>}</td>
                <td>
                  <select aria-label={`Стаття: ${f.purpose ?? f.id}`} value={f.category ?? ''} onChange={e => setCategory(f, e.target.value)}>
                    <option value="">{c.inferred ? `${c.category} (за описом)` : '—'}</option>
                    {FINANCE_CATEGORIES.map(x => <option key={x} value={x}>{x}</option>)}
                  </select>
                </td>
                <td>
                  <input type="text" aria-label={`Підпис для донорів: ${f.purpose ?? f.id}`} value={form.row_labels[String(f.id)] ?? ''}
                    placeholder={f.purpose ?? c.category} onChange={e => set({ row_labels: { ...form.row_labels, [String(f.id)]: e.target.value } })} />
                </td>
              </tr>
            );
          })}</tbody>
        </table></div>
      )}

      <h3 className="base-h3 base-gap">Фото для звіту</h3>
      {driveError ? <p role="alert" className="base-error">Не вдалося отримати фото з Google Drive: {driveError}</p>
        : !drive ? <p className="base-muted">Завантажую фото з Google Drive…</p>
        : drive.photos.length === 0 ? (
          <p className="base-muted">{drive.folder ? `У папці «${drive.folder.name}» на Google Drive ще немає фото.` : `На Google Drive немає папки «${v.id} …» у «Фото».`}</p>
        ) : (
          <>
            <p className="base-muted">Оберіть кілька фото «до» і «після». Перше фото «після» піде на обкладинку.</p>
            <ul className="base-photos base-photos--pick">{drive.photos.map(ph => {
              const path = drivePath(ph.id);
              const sel = form.photo_paths.find(p => p.path === path);
              return (
                <li key={ph.id} className={sel ? 'is-selected' : ''}>
                  <label>
                    <img src={ph.thumb} alt={ph.name} loading="lazy" />
                    <span className="base-photos__check"><input type="checkbox" checked={!!sel} onChange={e => togglePhoto(path, e.target.checked, ph.group)} aria-label={`Додати у звіт: ${ph.name}`} /> {ph.group ?? ph.name}</span>
                  </label>
                  {sel && (
                    <div className="base-photo__opts">
                      <select aria-label={`До чи після: ${ph.name}`} value={sel.kind ?? ''} onChange={e => patchPhoto(path, { kind: (e.target.value || null) as ReportPhoto['kind'] })}>
                        <option value="">—</option><option value="до">До ремонту</option><option value="після">Після ремонту</option>
                      </select>
                      <input type="text" aria-label={`Підпис до фото: ${ph.name}`} placeholder="Підпис до фото" value={sel.caption ?? ''} onChange={e => patchPhoto(path, { caption: e.target.value })} />
                    </div>
                  )}
                </li>
              );
            })}</ul>
          </>
        )}

      <div className="base-actions base-gap">
        <button type="button" className="base-secondary" disabled={busy !== null} onClick={onSave}>{busy === 'save' ? 'Зберігаю…' : 'Зберегти'}</button>
        <button type="button" className="base-secondary" disabled={busy !== null} onClick={() => generate(false)}>{busy === 'draft' ? 'Формую…' : 'Чернетка PDF'}</button>
        <button type="button" disabled={busy !== null} onClick={() => generate(true)}>{busy === 'final' ? 'Формую…' : 'Сформувати фінальний PDF'}</button>
        {msg && <span role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'base-ok' : 'base-error'}>{msg.text}</span>}
      </div>
    </section>
  );
}
