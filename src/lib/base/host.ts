// ЄДИНЕ МІСЦЕ, що залежить від «Штабу». При інтеграції підміняється:
//  • getSupabaseClient() → існуючий клієнт «Штабу»;
//  • решта файлу лишається як є.
// Без змінних середовища Supabase працює демо-режим на вигаданих даних.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { BaseApi, Role } from './types';
import { createSupabaseApi } from './supabaseApi';
import { createDemoApi, type DemoStore } from './demoApi';
import { demoData } from './demoData';

let client: SupabaseClient | null = null;
// Демо: одні дані на всю сесію сторінки, спільні для обох ролей.
let demoStore: DemoStore | null = null;
export function getSupabaseClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return (client ??= createClient(url, key));
}

export const isDemo = () => getSupabaseClient() === null;

export function createHostApi(demoRole?: Role): BaseApi {
  const sb = getSupabaseClient();
  return sb ? createSupabaseApi(sb) : createDemoApi(demoRole ?? 'head', undefined, (demoStore ??= demoData()));
}
