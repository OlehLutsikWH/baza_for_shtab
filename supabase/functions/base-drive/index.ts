// Edge Function «base-drive» (Deno, Supabase). Розгортання — див. INTEGRATION.md:
//   supabase functions deploy base-drive --no-verify-jwt
// --no-verify-jwt обов'язково: картинки відкриваються з <img> без заголовка Authorization
// (вони перевіряються підписом посилання), а список фото функція перевіряє сама.
// Секрети: GOOGLE_SERVICE_ACCOUNT_JSON (ключ сервісного акаунта «Штабу», напр. shtab-svit@shtab-tykho…),
//          BASE_DRIVE_PHOTOS_FOLDER_ID (папка «Фото»), BASE_DRIVE_URL_SECRET (довгий випадковий рядок).
// SUPABASE_URL і SUPABASE_ANON_KEY Supabase передає функції сам.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { createHandler } from './core.ts';

const env = (k: string) => {
  const v = Deno.env.get(k);
  if (!v) throw new Error(`Не задано секрет ${k}`);
  return v;
};
const SUPABASE_URL = env('SUPABASE_URL');
const ANON = env('SUPABASE_ANON_KEY');

const handler = createHandler({
  serviceAccount: JSON.parse(env('GOOGLE_SERVICE_ACCOUNT_JSON')),
  photosFolderId: env('BASE_DRIVE_PHOTOS_FOLDER_ID'),
  urlSecret: env('BASE_DRIVE_URL_SECRET'),
  publicBaseUrl: `${SUPABASE_URL}/functions/v1/base-drive`,
  fetch,
  now: () => Date.now(),
  authorize: async authorization => {
    if (!authorization?.startsWith('Bearer ')) return 'unauthorized';
    const sb = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
    const { data: u, error } = await sb.auth.getUser();
    if (error || !u.user) return 'unauthorized';
    const { data } = await sb.rpc('base_can_read');
    return data === true ? 'ok' : 'forbidden';
  },
});

Deno.serve(handler);
