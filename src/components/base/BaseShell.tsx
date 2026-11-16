'use client';
import { Suspense, type ReactNode } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { BaseApiProvider } from '../../lib/base/context';
import { isDemo } from '../../lib/base/host';
import type { Role } from '../../lib/base/types';

function Inner({ children }: { children: ReactNode }) {
  const params = useSearchParams();
  const demo = isDemo();
  // У демо-режимі роль перемикається адресою ?as=member для перевірки прав.
  const demoRole: Role = demo && params.get('as') === 'member' ? 'member' : 'head';
  return (
    <BaseApiProvider demoRole={demoRole} key={demoRole}>
      <div className="base-root">
        <header className="base-header">
          <Link href="/base/cars/" className="base-brand">СТО БАЗА · Облік авто</Link>
          {demo && <span className="base-demo" role="note">Демо-режим: вигадані дані{demoRole === 'member' ? ' · вигляд для члена команди' : ''}</span>}
        </header>
        <main className="base-main">{children}</main>
      </div>
    </BaseApiProvider>
  );
}

export function BaseShell({ children }: { children: ReactNode }) {
  return <Suspense fallback={<p className="base-muted base-pad">Завантаження…</p>}><Inner>{children}</Inner></Suspense>;
}
