// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BaseApiProvider } from '../src/lib/base/context';
import { createDemoApi } from '../src/lib/base/demoApi';
import { VehicleDetailView } from '../src/components/base/VehicleDetailView';
import { Dashboard } from '../src/components/base/Dashboard';

vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }));
// PDF у jsdom не формуємо (шрифти, canvas): перевіряємо, що панель правильно його замовляє й віддає
const renderMock = vi.fn(async () => new Blob(['%PDF-1.7 test'], { type: 'application/pdf' }));
vi.mock('../src/lib/base/report/render', () => ({
  renderDonorReportPdf: (...a: any[]) => renderMock(...(a as [])),
  reportFileName: (id: string, _now: Date, draft: boolean) => `zvit-${id}${draft ? '-chernetka' : ''}.pdf`,
}));
const saveMock = vi.fn();
vi.mock('../src/lib/base/files', () => ({ saveFile: (...a: any[]) => saveMock(...a) }));

afterEach(() => { cleanup(); renderMock.mockClear(); saveMock.mockClear(); });
const NOW = new Date();
const wrap = (role: 'head' | 'member', ui: React.ReactNode, api = createDemoApi(role, () => NOW)) =>
  ({ api, ...render(<BaseApiProvider api={api}>{ui}</BaseApiProvider>) });

describe('звіт для донорів в інтерфейсі', () => {
  it('керівник бачить вкладку на завершеному авто, член команди — ні', async () => {
    wrap('head', <VehicleDetailView id="АВТО-003" now={NOW} />);
    expect(await screen.findByRole('tab', { name: 'Звіт для донорів' })).toBeTruthy();
    cleanup();
    wrap('member', <VehicleDetailView id="АВТО-003" now={NOW} />);
    await screen.findByRole('tab', { name: /Роботи/ });
    expect(screen.queryByRole('tab', { name: 'Звіт для донорів' })).toBeNull();
  });
  it('на незавершеному авто вкладки немає; після «Готовий» з’являється підказка й вкладка', async () => {
    wrap('head', <VehicleDetailView id="АВТО-001" now={NOW} />);
    await screen.findByRole('tab', { name: /Роботи/ });
    expect(screen.queryByRole('tab', { name: 'Звіт для донорів' })).toBeNull();
    await userEvent.selectOptions(screen.getAllByRole('combobox')[0], 'Готовий');
    await userEvent.click(screen.getByRole('button', { name: 'Зберегти' }));
    await screen.findByText(/Чернетка звіту для донорів уже готова/);
    await userEvent.click(screen.getByRole('button', { name: 'Відкрити звіт' }));
    expect(screen.getByRole('tab', { name: 'Звіт для донорів' }).getAttribute('aria-selected')).toBe('true');
    await screen.findByRole('heading', { name: 'Звіт для донорів' });
  });
  it('попередження і сума; зміна статті витрати зберігається і оновлює попередження', async () => {
    const { api } = wrap('head', <VehicleDetailView id="АВТО-003" now={NOW} initialTab="report" />);
    const spy = vi.spyOn(api, 'setFinanceCategory');
    await screen.findByText('Перед відправленням перевірте');
    expect(screen.getByText(/Статтю 4 витрат визначено за описом/)).toBeTruthy();
    expect(screen.getAllByText(/72 100,50 грн/).length).toBeGreaterThan(0); // нерозривні пробіли нормалізуються в звичайні
    await userEvent.selectOptions(screen.getByLabelText('Стаття: Роботи з ремонту підвіски'), 'Роботи СТО');
    expect(spy).toHaveBeenCalledWith(8, 'Роботи СТО');
    await screen.findByText(/Статтю 3 витрат визначено за описом/);
  });
  it('чернетка PDF: зберігає правки, формує і віддає файл; статус лишається «Чернетка»', async () => {
    const { api } = wrap('head', <VehicleDetailView id="АВТО-003" now={NOW} initialTab="report" />);
    await screen.findByLabelText('Історія машини');
    await userEvent.type(screen.getByLabelText('Історія машини'), 'Машину чекали на передовій.');
    await userEvent.click(screen.getByRole('button', { name: 'Чернетка PDF' }));
    await screen.findByText(/Чернетку сформовано/);
    expect(renderMock).toHaveBeenCalledTimes(1);
    const model = (renderMock.mock.calls[0] as any[])[0];
    expect(model.story.paragraphs).toEqual(['Машину чекали на передовій.']);
    expect(model.draft).toBe(true);
    expect(saveMock.mock.calls[0][0]).toBe('zvit-АВТО-003-chernetka.pdf');
    expect((await api.getDonorReport('АВТО-003'))!.story).toBe('Машину чекали на передовій.');
    expect((await api.getDonorReport('АВТО-003'))!.status).toBe('Чернетка');
  });
  it('фінальний PDF: зберігається в системі, статус «Сформовано», зникає зі зведення', async () => {
    const api = createDemoApi('head', () => NOW);
    wrap('head', <VehicleDetailView id="АВТО-003" now={NOW} initialTab="report" />, api);
    await screen.findByRole('button', { name: 'Сформувати фінальний PDF' });
    await userEvent.click(screen.getByRole('button', { name: 'Сформувати фінальний PDF' }));
    await screen.findByText(/Фінальний звіт сформовано/);
    expect((renderMock.mock.calls[0] as any[])[0].draft).toBe(false);
    expect(within(screen.getByRole('region', { name: 'Звіт для донорів' })).getByText(/^Сформовано/)).toBeTruthy();
    expect((await api.listPendingReports())!.map(p => p.vehicle_id)).toEqual(['АВТО-004']);
  });
  it('підрозділ: галочка ховає поле назви; підпис витрати потрапляє в модель', async () => {
    wrap('head', <VehicleDetailView id="АВТО-003" now={NOW} initialTab="report" />);
    await screen.findByLabelText('Як назвати підрозділ у звіті');
    await userEvent.type(screen.getByLabelText('Підпис для донорів: Ремінь ГРМ (комплект)'), 'Комплект ГРМ');
    await userEvent.click(screen.getByLabelText(/Показувати підрозділ/));
    expect(screen.queryByLabelText('Як назвати підрозділ у звіті')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Чернетка PDF' }));
    await waitFor(() => expect(renderMock).toHaveBeenCalled());
    const model = (renderMock.mock.calls[0] as any[])[0];
    expect(model.unit).toBeNull();
    expect(model.invoices.find((i: any) => i.id === 3).label).toBe('Комплект ГРМ');
  });
  it('зведення: керівник бачить авто, що чекають звіту; член команди — ні', async () => {
    wrap('head', <Dashboard now={NOW} />);
    const sec = (await screen.findByRole('heading', { name: 'Звіти для донорів' })).closest('section')!;
    expect(within(sec).getByRole('link', { name: 'Тестовий Джип В' }).getAttribute('href')).toBe(`/base/car/?id=${encodeURIComponent('АВТО-003')}&tab=report`);
    cleanup();
    wrap('member', <Dashboard now={NOW} />);
    await screen.findByText('Зведення');
    expect(screen.queryByRole('heading', { name: 'Звіти для донорів' })).toBeNull();
  });
});
