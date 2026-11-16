import type { ReactNode } from 'react';
import { BaseShell } from '../../components/base/BaseShell';
import './base.css';

export const metadata = { title: 'СТО БАЗА · Облік авто' };

export default function BaseLayout({ children }: { children: ReactNode }) {
  return <BaseShell>{children}</BaseShell>;
}
