'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useBaseApi } from '../../lib/base/context';
import { buildDashboard, type DashboardData } from '../../lib/base/dashboard';
import { formatMoney } from '../../lib/base/format';
import { financeCsv, vehiclesCsv, download } from '../../lib/base/csv';
import type { FinanceItem, PendingReport, VehicleSummary } from '../../lib/base/types';
import { StatusBadge } from './StatusBadge';

export function Dashboard({ now: nowProp }: { now?: Date }) {
  const api = useBaseApi();
  const now = useMemo(() => nowProp ?? new Date(), [nowProp]);
  const [state, setState] = useState<{ list: VehicleSummary[]; fin: FinanceItem[] | null; d: DashboardData; pending: PendingReport[] | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let off = false;
    Promise.all([api.listVehicles(), api.statuses(), api.listFinance(), api.listPendingReports()])
      .then(([list, st, fin, pending]) => { if (!off) setState({ list, fin, pending, d: buildDashboard(list, st, fin, now) }); })
      .catch(e => { if (!off) setError(e instanceof Error ? e.message : String(e)); });
    return () => { off = true; };
  }, [api, now]);
  if (error) return <p role="alert" className="base-error">Не вдалося завантажити: {error}</p>;
  if (!state) return <p className="base-muted">Завантаження…</p>;
  const { list, fin, d, pending } = state;
  const stamp = now.toISOString().slice(0, 10);
  const Row = ({ v, why }: { v: VehicleSummary; why: string }) => (
    <li><Link href={`/base/car/?id=${encodeURIComponent(v.id)}`}><b>{v.name}</b></Link> <StatusBadge value={v.status} /> <span className="base-muted">{why}</span></li>
  );
  return (
    <div>
      <h1 className="base-h1">Зведення</h1>
      <ul className="base-tiles" aria-label="Загальні лічильники">
        <li><b>{d.active}</b><span>авто в роботі (з {d.total})</span></li>
        <li className={d.blocked.length ? 'base-tile--warn' : ''}><b>{d.blocked.length}</b><span>з блокером</span></li>
        <li className={d.stale.length ? 'base-tile--warn' : ''}><b>{d.stale.length}</b><span>давно не оновлювались</span></li>
        <li><b>{d.partsWaiting}</b><span>запчастин чекаємо</span></li>
      </ul>
      <section className="base-now"><h2 className="base-h2">За статусами</h2>
        <ul className="base-plain">{d.byStatus.map(s => <li key={s.status}><StatusBadge value={s.status} /> <b>{s.count}</b></li>)}</ul></section>
      <section className="base-now"><h2 className="base-h2">Потребують уваги</h2>
        {d.blocked.length + d.stale.length === 0 ? <p className="base-muted">Усе під контролем.</p> :
          <ul className="base-plain">
            {d.blocked.map(v => <Row key={'b' + v.id} v={v} why={`Блокер: ${v.blocker}`} />)}
            {d.stale.filter(v => !v.blocker).map(v => <Row key={'s' + v.id} v={v} why="давно не оновлювалось" />)}
          </ul>}</section>
      {pending && pending.length > 0 && (
        <section className="base-now"><h2 className="base-h2">Звіти для донорів</h2>
          <p className="base-muted">Ремонт завершено, звіт ще не сформовано:</p>
          <ul className="base-plain">{pending.map(p => (
            <li key={p.vehicle_id}><Link href={`/base/car/?id=${encodeURIComponent(p.vehicle_id)}&tab=report`}><b>{p.name}</b></Link> <StatusBadge value={p.status} /></li>
          ))}</ul>
        </section>)}
      {d.money && (
        <section className="base-now"><h2 className="base-h2">Гроші (лише керівники)</h2>
          <p>Очікує оплати: <b>{formatMoney(d.money.pending)}</b></p>
          {d.money.pendingUnattributed > 0 && <p className="base-stale">З них без вказаної особи: {formatMoney(d.money.pendingUnattributed)}</p>}
          {d.money.debtors.length > 0 && <ul className="base-plain">{d.money.debtors.map(x => <li key={x.person}>{x.person}: <b>{formatMoney(x.amount)}</b></li>)}</ul>}
        </section>)}
      <div className="base-actions">
        <button type="button" onClick={() => download(`avto-${stamp}.csv`, vehiclesCsv(list))}>Експорт авто (CSV)</button>
        {fin && <button type="button" onClick={() => download(`finansy-${stamp}.csv`, financeCsv(fin))}>Експорт фінансів (CSV)</button>}
      </div>
    </div>
  );
}
