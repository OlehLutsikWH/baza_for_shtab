// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BaseApiProvider } from '../src/lib/base/context';
import { createDemoApi } from '../src/lib/base/demoApi';
import { Dashboard } from '../src/components/base/Dashboard';
import { QuickEntry } from '../src/components/base/QuickEntry';
import { buildDashboard } from '../src/lib/base/dashboard';
import { toCsv, vehiclesCsv } from '../src/lib/base/csv';

vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }));
afterEach(cleanup);
const NOW = new Date();
const wrap = (role: 'head' | 'member', ui: React.ReactNode, api = createDemoApi(role, () => NOW)) =>
  render(<BaseApiProvider api={api}>{ui}</BaseApiProvider>);

describe('CSV', () => {
  it('BOM, роздільник «;», лапки, подвоєні лапки, переноси', () => {
    const c = toCsv([['a;b', 'він сказав "ок"', 'рядок\nдва', 5, null]]);
    expect(c.startsWith('﻿')).toBe(true);
    expect(c).toBe('﻿"a;b";"він сказав ""ок""";"рядок\nдва";5;\r\n');
  });
  it('захист від формул у текстових полях, числа не чіпає', () => {
    expect(toCsv([['=SUM(A1)', '+1', '-x', '@a', -5]])).toBe("﻿'=SUM(A1);'+1;'-x;'@a;-5\r\n");
  });
  it('експорт авто має заголовок і рядок на авто', async () => {
    const list = await createDemoApi('head', () => NOW).listVehicles();
    expect(vehiclesCsv(list).trim().split('\r\n').length).toBe(list.length + 1);
  });
});

describe('зведення', () => {
  it('рахунки узгоджені: сума по статусах = всього; борги = очікує оплати', async () => {
    const api = createDemoApi('head', () => NOW);
    const [list, st, fin] = await Promise.all([api.listVehicles(), api.statuses(), api.listFinance()]);
    const d = buildDashboard(list, st, fin, NOW);
    expect(d.byStatus.reduce((a, s) => a + s.count, 0)).toBe(d.total);
    const pending = fin!.filter(f => f.pay_status === 'Очікує оплати').reduce((a, f) => a + f.amount, 0);
    expect(d.money!.pending).toBe(pending);
    expect(d.money!.debtors.reduce((a, x) => a + x.amount, 0) + d.money!.pendingUnattributed).toBe(pending);
  });
  it('для учасника грошей немає взагалі', async () => {
    const api = createDemoApi('member', () => NOW);
    const d = buildDashboard(await api.listVehicles(), await api.statuses(), await api.listFinance(), NOW);
    expect(d.money).toBeNull();
  });
  it('UI: керівник бачить гроші й експорт фінансів, учасник — ні', async () => {
    wrap('head', <Dashboard now={NOW} />);
    await screen.findByText(/Гроші/);
    expect(screen.getByRole('button', { name: /фінансів/ })).toBeTruthy();
    cleanup();
    wrap('member', <Dashboard now={NOW} />);
    await screen.findByText('Зведення');
    expect(screen.queryByText(/Гроші/)).toBeNull();
    expect(screen.queryByRole('button', { name: /фінансів/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Експорт авто/ })).toBeTruthy();
  });
});

describe('швидке введення', () => {
  it('керівник додає запчастину; валідація кількості та авто', async () => {
    const api = createDemoApi('head', () => NOW);
    const spy = vi.spyOn(api, 'addPart');
    wrap('head', <QuickEntry />, api);
    await screen.findByLabelText('Авто');
    await userEvent.click(screen.getByRole('button', { name: 'Додати' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Оберіть авто/);
    await userEvent.selectOptions(screen.getByLabelText('Авто'), 'АВТО-001');
    await userEvent.selectOptions(screen.getByLabelText('Що додаємо'), 'part');
    await userEvent.type(screen.getByLabelText('Назва запчастини'), 'Фільтр');
    await userEvent.clear(screen.getByLabelText('Кількість')); await userEvent.type(screen.getByLabelText('Кількість'), '0');
    await userEvent.click(screen.getByRole('button', { name: 'Додати' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Кількість/);
    expect(spy).not.toHaveBeenCalled();
    await userEvent.clear(screen.getByLabelText('Кількість')); await userEvent.type(screen.getByLabelText('Кількість'), '2,5');
    await userEvent.click(screen.getByRole('button', { name: 'Додати' }));
    await screen.findByText('Запчастину додано.');
    expect(spy).toHaveBeenCalledWith({ vehicle_id: 'АВТО-001', name: 'Фільтр', qty: 2.5, supplier: null });
  });
  it('учасник форми не бачить, а API його відхиляє', async () => {
    wrap('member', <QuickEntry />);
    await screen.findByText(/лише керівникам/);
    await expect(createDemoApi('member').addJob({ vehicle_id: 'АВТО-001', description: 'x' })).rejects.toThrow();
  });
});
