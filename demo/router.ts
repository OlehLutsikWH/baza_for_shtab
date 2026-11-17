// Маршрутизація демо в пам'яті сторінки. Next-маршрути (/base/…) тут лише рядки:
// у вбудованому перегляді адресу сторінки міняти не можна, тому стан живе в JS.
export type Role = 'head' | 'member';
export interface RouteState { path: string; query: string; role: Role }

let state: RouteState = { path: '/base/', query: '', role: 'head' };
const subs = new Set<() => void>();

export const getState = () => state;
export function subscribe(fn: () => void) { subs.add(fn); return () => { subs.delete(fn); }; }
function set(next: Partial<RouteState>) { state = { ...state, ...next }; subs.forEach(f => f()); }

/** '/base/car/?id=АВТО-001' → шлях і query. Шлях завжди з кінцевим «/» (trailingSlash, як у «Штабі»). */
export function parseHref(href: string): { path: string; query: string } {
  const [rawPath, ...rest] = href.split('?');
  const path = rawPath.endsWith('/') ? rawPath : rawPath + '/';
  return { path, query: rest.join('?') };
}

export function navigate(href: string) {
  set(parseHref(href));
  try { window.scrollTo(0, 0); } catch { /* немає вікна — тести */ }
}
export const setRole = (role: Role) => set({ role });
