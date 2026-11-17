// Заміна next/navigation для демо: ті самі імена, що використовує модуль.
import { useSyncExternalStore } from 'react';
import { getState, subscribe, navigate } from '../router';

const useRoute = () => useSyncExternalStore(subscribe, getState, getState);

export function useSearchParams(): URLSearchParams {
  const s = useRoute();
  const p = new URLSearchParams(s.query);
  // BaseShell у демо читає роль з ?as=member — тут вона приходить з перемикача демо.
  if (s.role === 'member') p.set('as', 'member'); else p.delete('as');
  return p;
}
export const usePathname = () => useRoute().path;
export const useRouter = () => ({ push: navigate, replace: navigate, back: () => navigate('/base/'), refresh: () => {} });
export function redirect(href: string): never { navigate(href); throw new Error('redirect'); }
