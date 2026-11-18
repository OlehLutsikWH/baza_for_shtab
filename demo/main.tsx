// Демо модуля «Облік авто СТО БАЗА»: справжні сторінки й компоненти з src/,
// демо-дані в пам'яті, перемикач ролі. Збирається командою `npm run demo`.
import { createRoot } from 'react-dom/client';
import { useEffect, useState, useSyncExternalStore, type ComponentType } from 'react';
import BaseLayout from '../src/app/base/layout';
import DashboardPage from '../src/app/base/page';
import CarsPage from '../src/app/base/cars/page';
import CarPage from '../src/app/base/car/page';
import QuickPage from '../src/app/base/quick/page';
import PaymentsPage from '../src/app/base/payments/page';
import Link from './shims/next-link';
import { getState, subscribe, setRole, type Role } from './router';
import { onPreview, closePreview, type Preview } from './download';

function NotFound() {
  return <p className="base-empty">Такої сторінки немає. <Link href="/base/">До зведення</Link></p>;
}

const PAGES: Record<string, ComponentType> = {
  '/base/': DashboardPage, '/base/cars/': CarsPage, '/base/car/': CarPage, '/base/quick/': QuickPage, '/base/payments/': PaymentsPage,
};

const HINT: Record<Role, string> = {
  head: 'Керівник бачить фінанси, змінює статуси й додає записи.',
  member: 'Член команди бачить статуси, блокери й роботи. Фінансів і редагування немає.',
};

function RoleBar({ role }: { role: Role }) {
  return (
    <section className="demo-bar" aria-label="Перемикач ролі для демо">
      <div className="demo-bar__row">
        <span className="demo-bar__label" id="demo-role-label">Дивитись як</span>
        <div className="demo-seg" role="group" aria-labelledby="demo-role-label">
          <button type="button" id="demo-role-head" aria-pressed={role === 'head'} onClick={() => setRole('head')}>Керівник</button>
          <button type="button" id="demo-role-member" aria-pressed={role === 'member'} onClick={() => setRole('member')}>Член команди</button>
        </div>
      </div>
      <p className="demo-bar__hint">{HINT[role]} Ваші зміни живуть до перезавантаження сторінки.</p>
    </section>
  );
}

function FilePreview() {
  const [p, setP] = useState<Preview | null>(null);
  useEffect(() => onPreview(setP), []);
  useEffect(() => {
    if (!p) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closePreview(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [p]);
  if (!p) return null;
  const lines = p.text === null ? [] : p.text.replace(/^\uFEFF/, '').replace(/\r\n$/, '').split('\r\n');
  const MAX = 30;
  return (
    <div className="demo-scrim" onClick={e => { if (e.target === e.currentTarget) closePreview(); }}>
      <div className="demo-modal" role="dialog" aria-modal="true" aria-labelledby="demo-modal-title">
        <h2 id="demo-modal-title" className="demo-modal__title">{p.name}</h2>
        {p.note && <p className="demo-modal__note">{p.note}</p>}
        {lines.length > 0 && <div className="demo-pre"><pre>{lines.slice(0, MAX).join('\n')}</pre></div>}
        {lines.length > MAX && <p className="demo-modal__note">…і ще {lines.length - MAX} рядків</p>}
        <button type="button" className="demo-btn" id="demo-modal-close" onClick={closePreview} autoFocus>Закрити</button>
      </div>
    </div>
  );
}

function App() {
  const s = useSyncExternalStore(subscribe, getState, getState);
  const Page = PAGES[s.path] ?? NotFound;
  return (
    <>
      <RoleBar role={s.role} />
      <BaseLayout><Page /></BaseLayout>
      <FilePreview />
    </>
  );
}

const el = document.getElementById('root');
if (el) createRoot(el).render(<App />);
