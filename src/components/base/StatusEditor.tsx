'use client';
import { useState } from 'react';
import { useBaseApi } from '../../lib/base/context';
import type { Vehicle } from '../../lib/base/types';

/** Лише для керівників: оновити статус, блокер, наступний крок, відповідального. */
export function StatusEditor({ vehicle, statuses, onSaved }: { vehicle: Vehicle; statuses: string[]; onSaved: (v: Vehicle) => void }) {
  const api = useBaseApi();
  const [status, setStatus] = useState(vehicle.status);
  const [blocker, setBlocker] = useState(vehicle.blocker ?? '');
  const [nextStep, setNextStep] = useState(vehicle.next_step ?? '');
  const [responsible, setResponsible] = useState(vehicle.responsible ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const v = await api.updateVehicleStatus(vehicle.id, {
        status, blocker: blocker.trim() || null, next_step: nextStep.trim() || null, responsible: responsible.trim() || null,
      });
      onSaved(v); setMsg({ ok: true, text: 'Збережено' });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally { setBusy(false); }
  }

  return (
    <form className="base-editor" onSubmit={save} aria-label="Оновити статус">
      <h3 className="base-h3">Оновити статус</h3>
      <label className="base-field"><span>Статус</span>
        <select value={status} onChange={e => setStatus(e.target.value)}>{statuses.map(s => <option key={s}>{s}</option>)}</select>
      </label>
      <label className="base-field"><span>Що блокує</span>
        <input value={blocker} onChange={e => setBlocker(e.target.value)} placeholder="Порожньо, якщо нічого не блокує" /></label>
      <label className="base-field"><span>Що далі</span>
        <input value={nextStep} onChange={e => setNextStep(e.target.value)} /></label>
      <label className="base-field"><span>Відповідальний</span>
        <input value={responsible} onChange={e => setResponsible(e.target.value)} /></label>
      <div className="base-actions">
        <button type="submit" disabled={busy}>{busy ? 'Зберігаю…' : 'Зберегти'}</button>
        {msg && <span role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'base-ok' : 'base-error'}>{msg.text}</span>}
      </div>
    </form>
  );
}
