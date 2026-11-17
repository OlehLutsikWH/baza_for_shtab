'use client';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useBaseApi } from '../../lib/base/context';
import type { LegacyLink, Role, Vehicle, VehicleDetail } from '../../lib/base/types';
import { FINAL_STATUSES, ageLabel, financeTotals, formatDate, formatMoney, isStale, partsToGet } from '../../lib/base/format';
import { StatusBadge } from './StatusBadge';
import { StatusEditor } from './StatusEditor';
import { DonorReportPanel } from './DonorReportPanel';
import { PhotosTab } from './PhotosTab';

type Tab = 'jobs' | 'parts' | 'finance' | 'docs' | 'photos' | 'report';

function Links({ links }: { links: LegacyLink[] | null }) {
  if (!links?.length) return <span className="base-muted">—</span>;
  return <>{links.map((l, i) => (
    <a key={i} href={l.url} target="_blank" rel="noopener noreferrer" className="base-link">{l.text || 'відкрити'} <span className="base-muted">(Drive)</span></a>
  ))}</>;
}

function FileLink({ path }: { path: string }) {
  const api = useBaseApi();
  const [err, setErr] = useState<string | null>(null);
  async function open() {
    try { setErr(null); window.open(await api.signedUrl(path), '_blank', 'noopener,noreferrer'); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }
  return <><button type="button" className="base-linkbtn" onClick={open}>{path.split('/').pop()}</button>{err && <span role="alert" className="base-error"> {err}</span>}</>;
}

function Table({ head, children, empty }: { head: string[]; children: ReactNode[]; empty: string }) {
  if (children.length === 0) return <p className="base-empty">{empty}</p>;
  return (
    <div className="base-table-wrap"><table className="base-table">
      <thead><tr>{head.map(h => <th key={h} scope="col">{h}</th>)}</tr></thead>
      <tbody>{children}</tbody>
    </table></div>
  );
}

export function VehicleDetailView({ id, now: nowProp, initialTab }: { id: string | null; now?: Date; initialTab?: string | null }) {
  const api = useBaseApi();
  const now = useMemo(() => nowProp ?? new Date(), [nowProp]);
  const [detail, setDetail] = useState<VehicleDetail | null | undefined>(undefined);
  const [role, setRole] = useState<Role>('member');
  const [statuses, setStatuses] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(initialTab === 'report' ? 'report' : initialTab === 'photos' ? 'photos' : 'jobs');
  const [hasReport, setHasReport] = useState(false);
  const [reportNotice, setReportNotice] = useState(false);

  useEffect(() => {
    if (!id) { setDetail(null); return; }
    let off = false;
    Promise.all([api.getVehicleDetail(id), api.role(), api.statuses(), api.getDonorReport(id)])
      .then(([d, r, s, rep]) => { if (!off) { setDetail(d); setRole(r); setStatuses(s); setHasReport(!!rep); } })
      .catch(e => { if (!off) setError(e instanceof Error ? e.message : String(e)); });
    return () => { off = true; };
  }, [api, id]);

  const back = <Link href="/base/cars/" className="base-back">← До списку авто</Link>;
  if (error) return <>{back}<p role="alert" className="base-error">Не вдалося завантажити: {error}</p></>;
  if (detail === undefined) return <p className="base-muted">Завантаження…</p>;
  if (detail === null) return <>{back}<p className="base-empty">Авто не знайдено.</p></>;

  const { vehicle: v, jobs, parts, documents, finance } = detail;
  const isHead = role === 'head';
  const stale = isStale(v, now);
  const toGet = partsToGet(parts);
  const fin = finance ? financeTotals(finance) : null;
  const openJobs = jobs.filter(j => j.status !== 'Завершено');
  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'jobs', label: 'Роботи', count: jobs.length },
    { key: 'parts', label: 'Запчастини', count: parts.length },
    ...(finance ? [{ key: 'finance' as Tab, label: 'Фінанси', count: finance.length }] : []),
    { key: 'docs', label: 'Документи', count: documents.length },
    { key: 'photos', label: 'Фото' },
    ...(isHead && (FINAL_STATUSES.includes(v.status) || hasReport) ? [{ key: 'report' as Tab, label: 'Звіт для донорів' }] : []),
  ];
  const active: Tab = tabs.some(t => t.key === tab) ? tab : 'jobs';
  const saved = (nv: Vehicle) => {
    // ремонт щойно завершено → база вже створила чернетку звіту; підказуємо, де вона
    if (FINAL_STATUSES.includes(nv.status) && !FINAL_STATUSES.includes(v.status)) { setHasReport(true); setReportNotice(true); }
    setDetail({ ...detail, vehicle: nv });
  };

  return (
    <article>
      {back}
      <header className="base-vhead">
        <div>
          <h1 className="base-h1">{v.name}</h1>
          <p className="base-muted">{v.id}{v.vehicle_type ? ` · ${v.vehicle_type}` : ''}{v.military_unit ? ` · ${v.military_unit}` : ''}</p>
        </div>
        <StatusBadge value={v.status} />
      </header>

      <section className={`base-now${v.blocker ? ' base-now--blocked' : ''}`} aria-label="Що з машиною">
        <h2 className="base-h2">Що з машиною</h2>
        <dl className="base-dl">
          <dt>Блокер</dt><dd>{v.blocker ?? <span className="base-muted">Нічого не блокує</span>}</dd>
          <dt>Що далі</dt><dd>{v.next_step ?? <span className="base-muted">Не вказано</span>}</dd>
          <dt>Відповідальний</dt><dd>{v.responsible ?? <span className="base-muted">Не призначено</span>}</dd>
          <dt>Оновлено</dt><dd className={stale ? 'base-stale' : ''}>{ageLabel(v.status_updated_at, now)}{stale ? ' ⚠ давно не оновлювалось' : ''}</dd>
        </dl>
        {isHead && reportNotice && (
          <p className="base-notice" role="status">
            Ремонт завершено. Чернетка звіту для донорів уже готова.{' '}
            <button type="button" className="base-linkbtn" onClick={() => { setTab('report'); setReportNotice(false); }}>Відкрити звіт</button>
          </p>
        )}
        {isHead && <StatusEditor vehicle={v} statuses={statuses} onSaved={saved} />}
      </section>

      <ul className="base-tiles" aria-label="Підсумок">
        <li><b>{openJobs.length}</b><span>відкритих робіт</span></li>
        <li><b>{toGet.length}</b><span>запчастин чекаємо</span></li>
        {fin && <li><b>{formatMoney(fin.total)}</b><span>всього витрат</span></li>}
        {fin && <li className={fin.pending > 0 ? 'base-tile--warn' : ''}><b>{formatMoney(fin.pending)}</b><span>очікує оплати</span></li>}
      </ul>

      <dl className="base-dl base-dl--cols">
        <dt>VIN</dt><dd>{v.vin ?? '—'}</dd>
        <dt>Держномер</dt><dd>{v.plate ?? '—'}</dd>
        <dt>Хто надіслав запит</dt><dd>{v.requested_by ?? '—'}</dd>
        <dt>Призначення</dt><dd>{v.purpose ?? '—'}</dd>
        <dt>Прийнято</dt><dd>{formatDate(v.received_on)}</dd>
        <dt>Передано</dt><dd>{formatDate(v.handed_over_on)}</dd>
        {v.notes && <><dt>Примітки</dt><dd>{v.notes}</dd></>}
      </dl>

      <div role="tablist" className="base-tabs" aria-label="Розділи картки">
        {tabs.map(t => (
          <button key={t.key} role="tab" id={`tab-${t.key}`} aria-selected={active === t.key} aria-controls="base-panel"
            className={active === t.key ? 'is-active' : ''} onClick={() => setTab(t.key)}>
            {t.label}{t.count != null && <span className="base-count">{t.count}</span>}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="base-panel" aria-labelledby={`tab-${active}`} className="base-panel">
        {active === 'jobs' && (
          <Table head={['Робота', 'Статус', 'Виконавець', 'Місце', 'Початок', 'Кінець', 'Днів']} empty="Робіт ще немає.">
            {jobs.map(j => <tr key={j.id}>
              <td>{j.description ?? '—'}{j.notes && <div className="base-muted">{j.notes}</div>}</td>
              <td><StatusBadge value={j.status} /></td><td>{j.executor ?? '—'}</td><td>{j.location ?? '—'}</td>
              <td>{formatDate(j.started_on)}</td><td>{formatDate(j.finished_on)}</td><td>{j.duration_days ?? '—'}</td></tr>)}
          </Table>
        )}
        {active === 'parts' && (
          <Table head={['Запчастина', 'К-сть', 'Статус', 'Постачальник', 'Замовлено', 'Отримано']} empty="Запчастин ще немає.">
            {parts.map(p => <tr key={p.id}>
              <td>{p.name}{p.notes && <div className="base-muted">{p.notes}</div>}</td><td>{p.qty}</td><td><StatusBadge value={p.status} /></td>
              <td>{p.supplier ?? '—'}</td><td>{formatDate(p.ordered_on)}</td><td>{formatDate(p.received_on)}</td></tr>)}
          </Table>
        )}
        {active === 'finance' && finance && (
          <>
            <p className="base-muted">Оплачено {formatMoney(fin!.paid)} · очікує {formatMoney(fin!.pending)}</p>
            <Table head={['Дата', 'На що', 'Сума', 'Джерело', 'Особа', 'Оплата', 'Документ']} empty="Фінансових записів немає.">
              {finance.map(f => <tr key={f.id}>
                <td>{formatDate(f.spent_on)}</td><td>{f.purpose ?? '—'}</td><td className="base-num">{formatMoney(f.amount)}</td>
                <td>{f.source ?? '—'}</td><td>{f.person_dejure ?? '—'}</td><td><StatusBadge value={f.pay_status} /></td>
                <td>{f.doc_ref ?? ''} <Links links={f.legacy_links} /></td></tr>)}
            </Table>
          </>
        )}
        {active === 'docs' && (
          <Table head={['Тип', 'Дата', 'Файл', 'Примітки']} empty="Документів ще немає.">
            {documents.map(d => <tr key={d.id}>
              <td>{d.doc_type ?? '—'}</td><td>{formatDate(d.doc_date)}</td>
              <td>{d.storage_path ? <FileLink path={d.storage_path} /> : <Links links={d.legacy_links} />}</td><td>{d.notes ?? ''}</td></tr>)}
          </Table>
        )}
        {active === 'photos' && <PhotosTab vehicleId={v.id} />}
        {active === 'report' && isHead && <DonorReportPanel detail={detail} now={now} />}
      </div>
    </article>
  );
}
