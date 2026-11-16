'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { useBaseApi } from '../../lib/base/context';
import type { Role, VehicleSummary } from '../../lib/base/types';

type Kind = 'job' | 'part';

export function QuickEntry() {
  const api = useBaseApi();
  const [role, setRole] = useState<Role | null>(null);
  const [cars, setCars] = useState<VehicleSummary[]>([]);
  const [kind, setKind] = useState<Kind>('job');
  const [vehicle, setVehicle] = useState('');
  const [text, setText] = useState('');
  const [qty, setQty] = useState('1');
  const [who, setWho] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { Promise.all([api.role(), api.listVehicles()]).then(([r, l]) => { setRole(r); setCars(l); }); }, [api]);
  if (!role) return <p className="base-muted">Завантаження…</p>;
  if (role !== 'head') return <p className="base-empty">Швидке введення доступне лише керівникам.</p>;

  async function submit(e: FormEvent) {
    e.preventDefault(); setMsg(null);
    const n = Number(qty.replace(',', '.'));
    if (!vehicle) return setMsg({ ok: false, text: 'Оберіть авто.' });
    if (!text.trim()) return setMsg({ ok: false, text: kind === 'job' ? 'Опишіть роботу.' : 'Вкажіть назву запчастини.' });
    if (kind === 'part' && !(Number.isFinite(n) && n > 0)) return setMsg({ ok: false, text: 'Кількість має бути більшою за 0.' });
    setBusy(true);
    try {
      if (kind === 'job') await api.addJob({ vehicle_id: vehicle, description: text.trim(), executor: who.trim() || null });
      else await api.addPart({ vehicle_id: vehicle, name: text.trim(), qty: n, supplier: who.trim() || null });
      setMsg({ ok: true, text: kind === 'job' ? 'Роботу додано.' : 'Запчастину додано.' });
      setText(''); setWho(''); setQty('1');
    } catch (err) { setMsg({ ok: false, text: err instanceof Error ? err.message : String(err) }); }
    finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="base-editor" aria-label="Швидке введення">
      <h1 className="base-h1">Швидке введення</h1>
      <label>Авто
        <select value={vehicle} onChange={e => setVehicle(e.target.value)}>
          <option value="">— оберіть —</option>
          {cars.map(c => <option key={c.id} value={c.id}>{c.name} ({c.id})</option>)}
        </select></label>
      <label>Що додаємо
        <select value={kind} onChange={e => setKind(e.target.value as Kind)}>
          <option value="job">Робота</option><option value="part">Запчастина</option>
        </select></label>
      <label>{kind === 'job' ? 'Опис роботи' : 'Назва запчастини'}
        <input type="text" value={text} onChange={e => setText(e.target.value)} /></label>
      {kind === 'part' && <label>Кількість<input type="text" inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)} /></label>}
      <label>{kind === 'job' ? 'Виконавець (необов’язково)' : 'Постачальник (необов’язково)'}
        <input type="text" value={who} onChange={e => setWho(e.target.value)} /></label>
      <div className="base-actions">
        <button type="submit" disabled={busy}>{busy ? 'Додаю…' : 'Додати'}</button>
        {msg && <span role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'base-ok' : 'base-error'}>{msg.text}</span>}
      </div>
    </form>
  );
}
