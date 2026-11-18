'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { useBaseApi } from '../../lib/base/context';
import { formatDate, formatMoney } from '../../lib/base/format';
import type { FinanceItem, PaymentTarget, Role, VehicleSummary } from '../../lib/base/types';

const SHARED = '__shared', GENERAL = '__general';
const TARGET_LABEL = { shared: 'спільні (на кілька авто)', general: 'не про авто' } as const;
const sum = (xs: FinanceItem[]) => xs.reduce((a, f) => a + f.amount, 0);

/** Платежі без авто: керівник сам вирішує, куди їх віднести (рішення Олега 18.11.2026). */
export function PaymentsAssign() {
  const api = useBaseApi();
  const [role, setRole] = useState<Role | null>(null);
  const [items, setItems] = useState<FinanceItem[] | null>(null);
  const [cars, setCars] = useState<VehicleSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  useEffect(() => {
    let off = false;
    Promise.all([api.role(), api.listFinance(), api.listVehicles()])
      .then(([r, fin, list]) => { if (!off) { setRole(r); setItems(fin); setCars([...list].sort((a, b) => a.id.localeCompare(b.id))); } })
      .catch(e => { if (!off) setError(e instanceof Error ? e.message : String(e)); });
    return () => { off = true; };
  }, [api]);
  if (error) return <p role="alert" className="base-error">Не вдалося завантажити: {error}</p>;
  if (!role) return <p className="base-muted">Завантаження…</p>;
  if (role !== 'head' || !items) return <p className="base-empty">Платежі доступні лише керівникам.</p>;

  const open = items.filter(f => f.scope === 'unassigned');
  const shared = items.filter(f => f.scope === 'shared');
  const general = items.filter(f => f.scope === 'general');

  async function assign(f: FinanceItem, choice: string) {
    const target: PaymentTarget = choice === SHARED ? { scope: 'shared' } : choice === GENERAL ? { scope: 'general' } : { scope: 'vehicle', vehicle_id: choice };
    await api.assignPayment(f.id, target);
    setItems(list => (list ?? []).map(x => (x.id === f.id ? { ...x, scope: target.scope, vehicle_id: target.scope === 'vehicle' ? target.vehicle_id : null } : x)));
    const where = target.scope === 'vehicle' ? `${target.vehicle_id} ${cars.find(c => c.id === target.vehicle_id)?.name ?? ''}`.trim() : TARGET_LABEL[target.scope];
    setDone(`${formatMoney(f.amount)} · ${f.purpose ?? 'платіж'} → ${where}`);
  }
  const rows = (xs: FinanceItem[]) => <ul className="base-plain">{xs.map(f => <PaymentRow key={f.id} f={f} cars={cars} onAssign={assign} />)}</ul>;

  return (
    <div>
      <h1 className="base-h1">Платежі без авто</h1>
      <p className="base-muted">Платежі, які ще не віднесено до машини, і спільні. Для кожного обери, куди він іде: до машини, у спільні (на кілька авто) чи «не про авто» (оренда тощо).</p>
      {done && <p role="status" className="base-ok">Збережено: {done}</p>}
      <section className="base-now" aria-label="Не віднесені">
        <h2 className="base-h2">Не віднесені · {open.length}{open.length ? ` · ${formatMoney(sum(open))}` : ''}</h2>
        {open.length ? rows(open) : <p className="base-muted">Усі платежі віднесено.</p>}
      </section>
      <section className="base-now" aria-label="Спільні">
        <h2 className="base-h2">Спільні · {shared.length}{shared.length ? ` · ${formatMoney(sum(shared))}` : ''}</h2>
        <p className="base-muted">У звіти для донорів конкретних машин не входять, поки не віднесеш їх до машини.</p>
        {shared.length ? rows(shared) : <p className="base-muted">Немає.</p>}
      </section>
      {general.length > 0 && (
        <details className="base-now">
          <summary>Не про авто · {general.length} · {formatMoney(sum(general))}</summary>
          {rows(general)}
        </details>
      )}
    </div>
  );
}

function PaymentRow({ f, cars, onAssign }: { f: FinanceItem; cars: VehicleSummary[]; onAssign: (f: FinanceItem, choice: string) => Promise<void> }) {
  const [choice, setChoice] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!choice) return setErr('Оберіть, куди віднести платіж.');
    setBusy(true); setErr(null);
    try { await onAssign(f, choice); } catch (x) { setErr(x instanceof Error ? x.message : String(x)); } finally { setBusy(false); }
  }
  return (
    <li className="base-pay">
      <div>
        <b>{formatMoney(f.amount)}</b> <span className="base-muted">{formatDate(f.spent_on)}</span>
        <div>{f.purpose ?? 'Без призначення'}{f.doc_ref && <span className="base-muted"> · {f.doc_ref}</span>}</div>
        {f.pay_status !== 'Оплачено' && <div className="base-stale">{f.pay_status}</div>}
      </div>
      <form className="base-pay-form" onSubmit={submit}>
        <select aria-label={`Куди віднести: ${formatMoney(f.amount)}, ${f.purpose ?? 'платіж'}`} value={choice} onChange={e => setChoice(e.target.value)}>
          <option value="">Куди віднести…</option>
          <optgroup label="До машини">{cars.map(c => <option key={c.id} value={c.id}>{c.id} {c.name}</option>)}</optgroup>
          {f.scope !== 'shared' && <option value={SHARED}>Спільні (на кілька авто)</option>}
          {f.scope !== 'general' && <option value={GENERAL}>Не про авто (оренда тощо)</option>}
        </select>
        <button type="submit" className="base-primary" disabled={busy}>{busy ? 'Зберігаю…' : 'Зберегти'}</button>
        {err && <span role="alert" className="base-error">{err}</span>}
      </form>
    </li>
  );
}
