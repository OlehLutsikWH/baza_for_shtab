'use client';
// Фото авто з його папки на Google Drive («Фото» → «АВТО-0XX …»). Бачать усі члени команди.
import { useEffect, useState } from 'react';
import { useBaseApi } from '../../lib/base/context';
import type { DrivePhoto, VehiclePhotos } from '../../lib/base/types';

export function PhotosTab({ vehicleId }: { vehicleId: string }) {
  const api = useBaseApi();
  const [data, setData] = useState<VehiclePhotos | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let off = false;
    setData(null); setError(null);
    api.listVehiclePhotos(vehicleId)
      .then(r => { if (!off) setData(r); })
      .catch(e => { if (!off) setError(e instanceof Error ? e.message : String(e)); });
    return () => { off = true; };
  }, [api, vehicleId]);

  if (error) return <p role="alert" className="base-error">Не вдалося отримати фото: {error}</p>;
  if (!data) return <p className="base-muted">Завантажую фото з Google Drive…</p>;
  if (!data.folder) {
    return <p className="base-empty">На Google Drive немає папки з фото цього авто. Створіть у папці «Фото» підпапку, назва якої починається з «{vehicleId}», і фото з'являться тут.</p>;
  }
  const groups: { name: string | null; photos: DrivePhoto[] }[] = [];
  for (const p of data.photos) {
    const g = groups.find(x => x.name === p.group);
    if (g) g.photos.push(p); else groups.push({ name: p.group, photos: [p] });
  }
  return (
    <div className="base-photos-wrap">
      <p className="base-muted">
        {data.photos.length} фото · папка «{data.folder.name}»
        {data.folder.url && <> · <a className="base-link" href={data.folder.url} target="_blank" rel="noopener noreferrer">Відкрити на Google Drive</a></>}
      </p>
      {data.photos.length === 0 && <p className="base-empty">У папці ще немає фото.</p>}
      {groups.map(g => (
        <section key={g.name ?? '—'} aria-label={g.name ?? 'Фото'}>
          {g.name && <h3 className="base-h3">{g.name}</h3>}
          <ul className="base-photos">
            {g.photos.map(p => (
              <li key={p.id}>
                <a href={p.full} target="_blank" rel="noopener noreferrer" title={p.name}>
                  <img src={p.thumb} alt={p.name} loading="lazy" />
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {data.truncated && <p className="base-muted">Показано перші 500 фото.</p>}
    </div>
  );
}
