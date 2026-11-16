'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useBaseApi } from '../../lib/base/context';
import type { VehicleSummary } from '../../lib/base/types';
import { EMPTY_FILTER, ageLabel, filterVehicles, isStale, sortForAttention, type ListFilter } from '../../lib/base/format';
import { StatusBadge } from './StatusBadge';

export function VehicleList({ now: nowProp }: { now?: Date }) {
  const api = useBaseApi();
  const now = useMemo(() => nowProp ?? new Date(), [nowProp]);
  const [list, setList] = useState<VehicleSummary[] | null>(null);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState<ListFilter>(EMPTY_FILTER);

  useEffect(() => {
    let off = false;
    Promise.all([api.listVehicles(), api.statuses()])
      .then(([l, s]) => { if (!off) { setList(l); setStatuses(s); } })
      .catch(e => { if (!off) setError(e instanceof Error ? e.message : String(e)); });
    return () => { off = true; };
  }, [api]);

  const units = useMemo(() => [...new Set((list ?? []).map(v => v.military_unit).filter((x): x is string => !!x))].sort(), [list]);
  const shown = useMemo(() => sortForAttention(filterVehicles(list ?? [], f, now), now), [list, f, now]);

  if (error) return <p role="alert" className="base-error">Не вдалося завантажити: {error}</p>;
  if (!list) return <p className="base-muted">Завантаження…</p>;

  return (
    <section aria-labelledby="cars-h">
      <h1 id="cars-h" className="base-h1">Автомобілі</h1>
      <form className="base-filters" onSubmit={e => e.preventDefault()} role="search">
        <label className="base-field base-field--grow">
          <span>Пошук</span>
          <input type="search" value={f.query} placeholder="Назва, VIN, номер, частина…" onChange={e => setF({ ...f, query: e.target.value })} />
        </label>
        <label className="base-field">
          <span>Статус</span>
          <select value={f.status} onChange={e => setF({ ...f, status: e.target.value })}>
            <option value="">Усі</option>
            {statuses.map(s => <option key={s}>{s}</option>)}
          </select>
        </label>
        <label className="base-field">
          <span>Частина</span>
          <select value={f.unit} onChange={e => setF({ ...f, unit: e.target.value })}>
            <option value="">Усі</option>
            {units.map(u => <option key={u}>{u}</option>)}
          </select>
        </label>
        <label className="base-check"><input type="checkbox" checked={f.onlyBlocked} onChange={e => setF({ ...f, onlyBlocked: e.target.checked })} /> Є блокер</label>
        <label className="base-check"><input type="checkbox" checked={f.onlyStale} onChange={e => setF({ ...f, onlyStale: e.target.checked })} /> Давно не оновлювалось</label>
      </form>

      <p className="base-muted" aria-live="polite">Показано {shown.length} з {list.length}</p>
      {shown.length === 0 ? <p className="base-empty">Нічого не знайдено. Змініть пошук або фільтри.</p> : (
        <ul className="base-cards">
          {shown.map(v => {
            const stale = isStale(v, now);
            return (
              <li key={v.id}>
                <Link href={`/base/car/?id=${encodeURIComponent(v.id)}`} className={`base-card${v.blocker ? ' base-card--blocked' : ''}`}>
                  <div className="base-card__top">
                    <strong>{v.name}</strong>
                    <StatusBadge value={v.status} />
                  </div>
                  <div className="base-muted">{v.id}{v.military_unit ? ` · ${v.military_unit}` : ''}</div>
                  {v.blocker && <p className="base-line"><b>Блокер:</b> {v.blocker}</p>}
                  {v.next_step && <p className="base-line"><b>Далі:</b> {v.next_step}</p>}
                  <div className="base-card__meta">
                    {v.responsible && <span>Відповідальний: {v.responsible}</span>}
                    <span className={stale ? 'base-stale' : ''}>Оновлено {ageLabel(v.status_updated_at, now)}{stale ? ' ⚠ давно' : ''}</span>
                    {v.open_jobs > 0 && <span>Робіт відкрито: {v.open_jobs}</span>}
                    {v.parts_to_get > 0 && <span>Чекаємо запчастин: {v.parts_to_get}</span>}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
