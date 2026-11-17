// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BaseApiProvider } from '../src/lib/base/context';
import { createDemoApi } from '../src/lib/base/demoApi';
import { VehicleDetailView } from '../src/components/base/VehicleDetailView';
import { kindFromGroup, drivePath, driveIdOf } from '../src/lib/base/photos';

vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }));
const renderMock = vi.fn(async () => new Blob(['%PDF-1.7 test'], { type: 'application/pdf' }));
vi.mock('../src/lib/base/report/render', () => ({
  renderDonorReportPdf: (...a: any[]) => renderMock(...(a as [])),
  reportFileName: (id: string, _n: Date, draft: boolean) => `zvit-${id}${draft ? '-chernetka' : ''}.pdf`,
}));
vi.mock('../src/lib/base/files', () => ({ saveFile: vi.fn() }));

afterEach(() => { cleanup(); renderMock.mockClear(); });
const NOW = new Date();
const wrap = (role: 'head' | 'member', ui: React.ReactNode, api = createDemoApi(role, () => NOW)) =>
  ({ api, ...render(<BaseApiProvider api={api}>{ui}</BaseApiProvider>) });

describe('фото з Google Drive', () => {
  it('вкладка «Фото» є і в керівника, і в члена команди; групи з підпапок', async () => {
    for (const role of ['head', 'member'] as const) {
      wrap(role, <VehicleDetailView id="АВТО-003" now={NOW} />);
      await userEvent.click(await screen.findByRole('tab', { name: 'Фото' }));
      await screen.findByText(/4 фото · папка «АВТО-003 Тестовий Джип В \(демо\)»/);
      expect(within(screen.getByRole('region', { name: 'До ремонту' })).getAllByRole('img')).toHaveLength(2);
      expect(within(screen.getByRole('region', { name: 'Після ремонту' })).getAllByRole('img')).toHaveLength(2);
      expect(screen.queryByText('Відкрити на Google Drive')).toBeNull(); // у демо посилання на папку немає
      cleanup();
    }
  });
  it('немає папки на Drive — підказка з номером авто', async () => {
    wrap('member', <VehicleDetailView id="АВТО-002" now={NOW} initialTab="photos" />);
    await screen.findByText(/починається з «АВТО-002»/);
  });
  it('помилка Drive — повідомлення, картка працює', async () => {
    const api = createDemoApi('member', () => NOW);
    api.listVehiclePhotos = async () => { throw new Error('Google Drive: 503'); };
    wrap('member', <VehicleDetailView id="АВТО-003" now={NOW} initialTab="photos" />, api);
    expect((await screen.findByRole('alert')).textContent).toContain('Google Drive: 503');
    expect(screen.getByRole('tab', { name: /Роботи/ })).toBeTruthy();
  });
  it('звіт: вибране фото «після» підставляється в PDF зі свіжим посиланням і видом «після»', async () => {
    wrap('head', <VehicleDetailView id="АВТО-003" now={NOW} initialTab="report" />);
    await userEvent.click(await screen.findByLabelText('Додати у звіт: gotovyi-1.jpg'));
    expect((screen.getByLabelText('До чи після: gotovyi-1.jpg') as HTMLSelectElement).value).toBe('після');
    await userEvent.type(screen.getByLabelText('Підпис до фото: gotovyi-1.jpg'), 'Готовий до передачі');
    await userEvent.click(screen.getByRole('button', { name: 'Чернетка PDF' }));
    await waitFor(() => expect(renderMock).toHaveBeenCalled());
    const model = (renderMock.mock.calls[0] as any[])[0];
    expect(model.images).toHaveLength(1);
    expect(model.images[0]).toMatchObject({ kind: 'після', caption: 'Готовий до передачі' });
    expect(model.images[0].src).toMatch(/^data:image\/png/);
    expect(model.warnings.join(' ')).not.toMatch(/Немає фото/);
  });
  it('фото зникло з Drive до формування — пропускається з повідомленням', async () => {
    const api = createDemoApi('head', () => NOW);
    wrap('head', <VehicleDetailView id="АВТО-003" now={NOW} initialTab="report" />, api);
    await userEvent.click(await screen.findByLabelText('Додати у звіт: pryiom-1.jpg'));
    const orig = api.listVehiclePhotos.bind(api);
    api.listVehiclePhotos = async id => { const r = await orig(id); return { ...r, photos: r.photos.filter(p => p.name !== 'pryiom-1.jpg') }; };
    await userEvent.click(screen.getByRole('button', { name: 'Чернетка PDF' }));
    await screen.findByText(/вибране фото вже зникло з Drive/);
    expect((renderMock.mock.calls[0] as any[])[0].images).toEqual([]);
  });
});

describe('допоміжне для фото', () => {
  it('вид з назви підпапки', () => {
    expect(kindFromGroup('До ремонту')).toBe('до');
    expect(kindFromGroup('Після ремонту')).toBe('після');
    expect(kindFromGroup('фото до')).toBe('до');
    expect(kindFromGroup('Документи')).toBeNull();
    expect(kindFromGroup(null)).toBeNull();
  });
  it('шлях drive:', () => {
    expect(driveIdOf(drivePath('abc123'))).toBe('abc123');
    expect(driveIdOf('vehicles/АВТО-001/x.jpg')).toBeNull();
  });
});
