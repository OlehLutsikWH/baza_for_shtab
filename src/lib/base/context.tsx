'use client';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { BaseApi, Role } from './types';
import { createHostApi } from './host';

const Ctx = createContext<BaseApi | null>(null);

/** Постачає API компонентам. У тестах підставляється явний `api`. */
export function BaseApiProvider({ api, demoRole, children }: { api?: BaseApi; demoRole?: Role; children: ReactNode }) {
  const value = useMemo(() => api ?? createHostApi(demoRole), [api, demoRole]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBaseApi(): BaseApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('BaseApiProvider відсутній');
  return v;
}
