// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BaseApiProvider } from '../src/lib/base/context';
import { createDemoApi } from '../src/lib/base/demoApi';
import { VehicleList } from '../src/components/base/VehicleList';
import { VehicleDetailView } from '../src/components/base/VehicleDetailView';
import { filterVehicles, sortForAttention, isStale, EMPTY_FILTER, financeTotals, ageLabel } from '../src/lib/base/format';

vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }));
afterEach(cleanup);
const NOW = new Date();
const wrap = (role: 'head' | 'member', ui: React.ReactNode) =>
  render(<BaseApiProvider api={createDemoApi(role, () => NOW)}>{ui}</BaseApiProvider>);

describe('логіка списку', () => {
  it('сортує: блокер → застаріле → решта → фінальні', async () => {
    const list = await createDemoApi('head', () => NOW).listVehicles();
    const s = sortForAttention(list, NOW);
    const firstFinal = s.findIndex(v => ['Готовий', 'Передано частині'].includes(v.status));
    const lastActive = s.map(v => !['Готовий', 'Передано частині'].includes(v.status)).lastIndexOf(true);
    expect(firstFinal === -1 || firstFinal > lastActive).toBe(true);
    if (s[0].blocker) expect(s.findIndex(v => !v.blocker && !['Готовий', 'Передано частині'].includes(v.status))).toBeGreaterThan(-1);
  });
  it('фільтр «блокер» лишає лише авто з блокером', async () => {
    const list = await createDemoApi('head', () => NOW).listVehicles();
    const r = filterVehicles(list, { ...EMPTY_FILTER, onlyBlocked: true }, NOW);
    expect(r.length).toBeGreaterThan(0);
    expect(r.every(v => !!v.blocker)).toBe(true);
  });
  it('фінальні статуси ніколи не «застарілі»', () => {
    expect(isStale({ status: 'Готовий', status_updated_at: '2000-01-01T00:00:00Z' }, NOW)).toBe(false);
    expect(isStale({ status: 'В ремонті', status_updated_at: '2000-01-01T00:00:00Z' }, NOW)).toBe(true);
  });
  it('підсумки фінансів', () => {
    expect(financeTotals([{ amount: 100, pay_status: 'Оплачено' }, { amount: 50, pay_status: 'Очікує оплати' }]))
      .toMatchObject({ total: 150, paid: 100, pending: 50 });
  });
  it('ageLabel: сьогодні/вчора/дні', () => {
    expect(ageLabel(NOW.toISOString(), NOW)).toBe('сьогодні');
    expect(ageLabel(new Date(NOW.getTime() - 86400000).toISOString(), NOW)).toBe('вчора');
    expect(ageLabel(new Date(NOW.getTime() - 5 * 86400000).toISOString(), NOW)).toBe('5 днів тому');
  });
});

describe('інтерфейс', () => {
  it('список показує лічильник і фільтрується пошуком', async () => {
    wrap('head', <VehicleList now={NOW} />);
    await screen.findByText(/Показано \d+ з \d+/);
    const all = screen.getAllByRole('link').length;
    await userEvent.type(screen.getByRole('searchbox'), 'zzzнемає');
    expect(screen.queryAllByRole('link').length).toBeLessThan(all);
  });
  it('керівник бачить Фінанси і редактор статусу', async () => {
    wrap('head', <VehicleDetailView id="АВТО-001" now={NOW} />);
    await screen.findByRole('tab', { name: /Фінанси/ });
    expect(screen.getByRole('button', { name: /Зберегти/ })).toBeTruthy();
  });
  it('учасник НЕ бачить фінансів, сум витрат і редактора', async () => {
    wrap('member', <VehicleDetailView id="АВТО-001" now={NOW} />);
    await screen.findByRole('tab', { name: /Роботи/ });
    expect(screen.queryByRole('tab', { name: /Фінанси/ })).toBeNull();
    expect(screen.queryByText(/всього витрат/)).toBeNull();
    expect(screen.queryByText(/очікує оплати/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Зберегти/ })).toBeNull();
  });
  it('неіснуюче авто — повідомлення, не падіння', async () => {
    wrap('head', <VehicleDetailView id="АВТО-999" now={NOW} />);
    await screen.findByText('Авто не знайдено.');
  });
});
