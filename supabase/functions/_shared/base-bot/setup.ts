// Спільне налаштування бота для Edge Functions base-bot і base-reminders (Deno).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { createBaseBot, type PhotoSink } from './core.ts';
import { createSupabaseBotStore } from './store-supabase.ts';
import { createTelegram } from './telegram.ts';
import { createScriptPhotoSink } from './sink-script.ts';
import { createDrivePhotoSink } from './sink-drive.ts';
import { createDrive, createGoogleAuth, SCOPE_WRITE } from '../google-drive.ts';

export function env(k: string, fallback?: string): string {
  const v = Deno.env.get(k) ?? fallback;
  if (v === undefined) throw new Error(`Не задано секрет ${k}`);
  return v;
}

/** Куди бот кладе фото. Без налаштувань — бот фото не приймає (і так і каже).
 *  BASE_PHOTO_SCRIPT_URL (+ BASE_PHOTO_SCRIPT_SECRET) — Apps Script від імені власника папки «Фото»: для особистого «Мій диск».
 *  BASE_PHOTO_SINK=service-account — сервісний акаунт «Штабу»: лише якщо «Фото» на спільному диску Google Workspace. */
export function makePhotoSink(): PhotoSink | undefined {
  const scriptUrl = Deno.env.get('BASE_PHOTO_SCRIPT_URL');
  if (scriptUrl) return createScriptPhotoSink({ url: scriptUrl, secret: env('BASE_PHOTO_SCRIPT_SECRET') });
  if (Deno.env.get('BASE_PHOTO_SINK') === 'service-account') {
    const drive = createDrive(createGoogleAuth(JSON.parse(env('GOOGLE_SERVICE_ACCOUNT_JSON')), SCOPE_WRITE, fetch, Date.now), fetch);
    return createDrivePhotoSink(drive, env('BASE_DRIVE_PHOTOS_FOLDER_ID'));
  }
  return undefined;
}

export function makeBot() {
  const sb = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
  const headIds = env('BASE_BOT_HEADS', '').split(/[\s,;]+/).map(Number).filter(n => Number.isSafeInteger(n) && n > 0);
  return createBaseBot(createSupabaseBotStore(sb), createTelegram(env('TELEGRAM_BOT_TOKEN')), {
    appUrl: env('BASE_APP_URL', ''), headIds,
    timeZone: env('BASE_BOT_TZ', 'Europe/Kyiv'), digestHour: Number(env('BASE_BOT_DIGEST_HOUR', '9')),
    photoSink: makePhotoSink(),
    photoUploaders: env('BASE_BOT_PHOTO_UPLOADERS', 'all') === 'heads' ? 'heads' : 'all',
  });
}
