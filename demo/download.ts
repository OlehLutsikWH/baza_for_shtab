// Демо-заміна saveFile() з src/lib/base/files.ts. Сторінка-артефакт не може сама почати завантаження,
// тому файл віддається через можливість downloads; якщо її немає — показуємо вміст (CSV) або пояснення (PDF).
type Saver = { save(r: { filename: string; data: string | Blob }): Promise<{ status: string }> };
export type Preview = { name: string; text: string | null; note?: string };

const listeners = new Set<(p: Preview | null) => void>();
export function onPreview(fn: (p: Preview | null) => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
export const closePreview = () => listeners.forEach(f => f(null));
const show = (p: Preview) => listeners.forEach(f => f(p));

export async function demoSaveFile(name: string, data: Blob | string, _type?: string): Promise<void> {
  let saver: Saver | null = null;
  try { saver = (await (window as any).claude?.use?.('downloads')) as Saver | null; } catch { saver = null; }
  const text = typeof data === 'string' ? data : null;
  if (saver) {
    try { await saver.save({ filename: name, data }); return; }
    catch (e: any) {
      if (e?.code === 'declined') return; // людина відмовилась — нічого не робимо
      if (e?.code === 'rate_limited') { show({ name, text, note: 'Вікно збереження вже відкрите. Спробуйте ще раз за мить.' }); return; }
    }
  }
  show({
    name, text,
    note: text !== null
      ? 'У цьому перегляді файл не можна зберегти, тому ось його вміст. У застосунку файл одразу завантажиться і відкриється в Excel.'
      : 'Файл сформовано, але цей перегляд не дає його зберегти. Відкрийте демо на claude.ai — там з’явиться вікно збереження.',
  });
}
