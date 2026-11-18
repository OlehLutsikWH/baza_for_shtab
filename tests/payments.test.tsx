// @vitest-environment jsdom
// Платежі без авто: керівник вирішує, куди віднести (рішення Олега 18.11.2026).
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BaseApiProvider } from '../src/lib/base/context';
import { createDemoApi } from '../src/lib/base/demoApi';
import { demoData } from '../src/lib/base/demoData';
import { PaymentsAssign } from '../src/components/base/PaymentsAssign';
import { Dashboard } from '../src/components/base/Dashboard';
import { buildDonorReport } from '../src/lib/base/report/model';
import { freshDb, seed } from './helpers';

vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }));
afterEach(cleanup);
const NOW = new Date('2026-11-18T10:00:00Z');
const norm = (s: string) => s.replace(/\s+/g, ' ');

function setup(role: 'head' | 'member' = 'head') {
  const store = demoData(NOW);
  const api = createDemoApi(role, () => NOW, store);
  render(<BaseApiProvider api={api}><PaymentsAssign /></BaseApiProvider>);
  return { store, api };
}
const section = (name: string) => screen.getByRole('region', { name });

describe('сторінка «Платежі без авто»', () => {
  it('показує невіднесені з сумою; «не про авто» — згорнуто; член команди бачить лише пояснення', async () => {
    setup();
    const open = await screen.findByRole('region', { name: 'Не віднесені' });
    expect(norm(within(open).getByRole('heading').textContent!)).toMatch(/^Не віднесені · 2 · 4 050,00/);
    expect(within(open).getByText('Нова пошта: доставка запчастин')).toBeTruthy();
    expect(within(open).getByText('Евакуатор: перевезення двох авто на СТО')).toBeTruthy();
    expect(within(section('Спільні')).getByText('Немає.')).toBeTruthy();
    expect(norm(screen.getByText(/^Не про авто ·/).textContent!)).toMatch(/^Не про авто · 1 · 32 100,00/);
    cleanup();
    setup('member');
    expect(await screen.findByText('Платежі доступні лише керівникам.')).toBeTruthy();
  });
  it('до машини: платіж зникає зі списку, з’являється у фінансах авто й у звіті для донорів', async () => {
    const { store, api } = setup();
    const open = await screen.findByRole('region', { name: 'Не віднесені' });
    const box = within(open).getByRole('combobox', { name: /450,00.*Нова пошта/ });
    await userEvent.selectOptions(box, 'АВТО-003');
    await userEvent.click(within(box.closest('form')!).getByRole('button', { name: 'Зберегти' }));
    expect(norm((await screen.findByRole('status')).textContent!)).toMatch(/Збережено: 450,00 .* Нова пошта: доставка запчастин → АВТО-003/);
    expect(within(section('Не віднесені')).queryByText('Нова пошта: доставка запчастин')).toBeNull();
    expect(store.finance.find(f => f.id === 14)).toMatchObject({ scope: 'vehicle', vehicle_id: 'АВТО-003' });
    const detail = await api.getVehicleDetail('АВТО-003');
    expect(detail!.finance!.some(f => f.id === 14)).toBe(true);
    const report = buildDonorReport({ vehicle: detail!.vehicle, jobs: detail!.jobs, parts: detail!.parts, finance: detail!.finance!, report: store.reports.find(r => r.vehicle_id === 'АВТО-003') ?? null, now: NOW });
    const others = detail!.finance!.filter(f => f.id !== 14).reduce((a, f) => a + f.amount, 0);
    expect(report.figures.total).toBe(others + 450); // 450 грн тепер у звіті цієї машини
  });
  it('у спільні й назад до машини; «не про авто» — у згорнутий список; без вибору — підказка', async () => {
    const { store } = setup();
    const open = await screen.findByRole('region', { name: 'Не віднесені' });
    const evac = within(open).getByRole('combobox', { name: /3 600,00.*Евакуатор/ });
    await userEvent.click(within(evac.closest('form')!).getByRole('button', { name: 'Зберегти' }));
    expect(within(evac.closest('form')!).getByRole('alert').textContent).toBe('Оберіть, куди віднести платіж.');
    await userEvent.selectOptions(evac, 'Спільні (на кілька авто)');
    await userEvent.click(within(evac.closest('form')!).getByRole('button', { name: 'Зберегти' }));
    expect(store.finance.find(f => f.id === 15)).toMatchObject({ scope: 'shared', vehicle_id: null });
    const shared = section('Спільні');
    const again = within(shared).getByRole('combobox', { name: /Евакуатор/ });
    expect(within(again).queryByRole('option', { name: 'Спільні (на кілька авто)' })).toBeNull(); // уже спільний — такого вибору немає
    await userEvent.selectOptions(again, 'АВТО-001');
    await userEvent.click(within(again.closest('form')!).getByRole('button', { name: 'Зберегти' }));
    expect(store.finance.find(f => f.id === 15)).toMatchObject({ scope: 'vehicle', vehicle_id: 'АВТО-001' });
    const np = within(section('Не віднесені')).getByRole('combobox', { name: /Нова пошта/ });
    await userEvent.selectOptions(np, 'Не про авто (оренда тощо)');
    await userEvent.click(within(np.closest('form')!).getByRole('button', { name: 'Зберегти' }));
    expect(store.finance.find(f => f.id === 14)).toMatchObject({ scope: 'general', vehicle_id: null });
    expect(within(section('Не віднесені')).getByText('Усі платежі віднесено.')).toBeTruthy();
    expect(norm(screen.getByText(/^Не про авто ·/).textContent!)).toMatch(/^Не про авто · 2 ·/);
  });
  it('зведення нагадує про невіднесені платежі з посиланням', async () => {
    render(<BaseApiProvider api={createDemoApi('head', () => NOW)}><Dashboard now={NOW} /></BaseApiProvider>);
    const line = await screen.findByText(/Платежі без авто:/);
    expect(norm(line.textContent!)).toMatch(/Платежі без авто: 2 на 4 050,00 .* — розподілити/);
    expect(within(line).getByRole('link', { name: 'розподілити' }).getAttribute('href')).toBe('/base/payments/');
  });
});

describe('база: віднесення платежу', () => {
  it('керівник змінює scope; член команди — ні; «до авто» без машини і машина в «спільних» — заборонено', async () => {
    const db = await freshDb();
    await seed(db);
    const HEAD = '00000000-0000-0000-0000-0000000000a1', MEMBER = '00000000-0000-0000-0000-0000000000b2';
    await db.exec(`insert into stub_members values ('${HEAD}', true), ('${MEMBER}', false);
      insert into base_finance (scope, amount, purpose, pay_status) values ('unassigned', 450, 'Нова пошта', 'Оплачено');`);
    const as = async (uid: string) => { await db.exec('reset role'); await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]); await db.exec('set role authenticated'); };
    await as(MEMBER);
    await db.exec(`update base_finance set scope = 'vehicle', vehicle_id = 'АВТО-001'`);
    await db.exec('reset role');
    expect((await db.query<any>(`select scope from base_finance`)).rows[0].scope).toBe('unassigned');
    await as(HEAD);
    await db.exec(`update base_finance set scope = 'vehicle', vehicle_id = 'АВТО-001'`);
    expect((await db.query<any>(`select scope, vehicle_id from base_finance`)).rows[0]).toEqual({ scope: 'vehicle', vehicle_id: 'АВТО-001' });
    await expect(db.exec(`update base_finance set scope = 'vehicle', vehicle_id = null`)).rejects.toThrow();
    await expect(db.exec(`update base_finance set scope = 'shared'`)).rejects.toThrow(); // машина лишилась — суперечність
    await db.exec(`update base_finance set scope = 'shared', vehicle_id = null`);
    expect((await db.query<any>(`select scope, vehicle_id from base_finance`)).rows[0]).toEqual({ scope: 'shared', vehicle_id: null });
  });
});
