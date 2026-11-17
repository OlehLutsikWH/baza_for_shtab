// Спільне налаштування бота для Edge Functions base-bot і base-reminders (Deno).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { createBaseBot } from './core.ts';
import { createSupabaseBotStore } from './store-supabase.ts';
import { createTelegram } from './telegram.ts';

export function env(k: string, fallback?: string): string {
  const v = Deno.env.get(k) ?? fallback;
  if (v === undefined) throw new Error(`Не задано секрет ${k}`);
  return v;
}

export function makeBot() {
  const sb = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
  const headIds = env('BASE_BOT_HEADS', '').split(/[\s,;]+/).map(Number).filter(n => Number.isSafeInteger(n) && n > 0);
  return createBaseBot(createSupabaseBotStore(sb), createTelegram(env('TELEGRAM_BOT_TOKEN')), {
    appUrl: env('BASE_APP_URL', ''), headIds,
    timeZone: env('BASE_BOT_TZ', 'Europe/Kyiv'), digestHour: Number(env('BASE_BOT_DIGEST_HOUR', '9')),
  });
}
