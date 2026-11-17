// Edge Function «base-reminders»: щогодинний запуск нагадувань (pg_cron → pg_net, див. base_005_bot.sql).
// Розгортання: supabase functions deploy base-reminders --no-verify-jwt  (захист — заголовок x-base-cron)
import { makeBot, env } from '../_shared/base-bot/setup.ts';

const bot = makeBot();
const SECRET = env('BASE_CRON_SECRET');

Deno.serve(async req => {
  if (req.headers.get('x-base-cron') !== SECRET) return new Response('forbidden', { status: 403 });
  try {
    const r = await bot.runScheduled();
    return Response.json({ ok: true, ...r });
  } catch (e) {
    console.error('base-reminders', e);
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
});
