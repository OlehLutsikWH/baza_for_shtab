// Демо працює без Supabase: host.ts бачить порожні змінні середовища й бере демо-API.
export function createClient(): never { throw new Error('Supabase у демо не використовується'); }
export type SupabaseClient = never;
