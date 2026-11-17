// Edge Function «base-bot»: вебхук Telegram для бота «Бази» (якщо в «Бази» свій бот).
// Якщо «База» працює всередині наявного бота «Штабу» — цю функцію не розгортати, а в його обробнику
// викликати makeBot().handleUpdate(update) для оновлень, які сам «Штаб» не обробив (див. INTEGRATION.md).
// Розгортання: supabase functions deploy base-bot --no-verify-jwt
// Вебхук: https://api.telegram.org/bot<TOKEN>/setWebhook?url=<адреса функції>&secret_token=<BASE_BOT_WEBHOOK_SECRET>
import { makeBot, env } from '../_shared/base-bot/setup.ts';

const bot = makeBot();
const SECRET = env('BASE_BOT_WEBHOOK_SECRET');

Deno.serve(async req => {
  if (req.method !== 'POST') return new Response('ok');
  if (req.headers.get('x-telegram-bot-api-secret-token') !== SECRET) return new Response('forbidden', { status: 403 });
  try {
    await bot.handleUpdate(await req.json());
  } catch (e) {
    console.error('base-bot', e); // Telegram має отримати 200, інакше повторюватиме те саме оновлення
  }
  return new Response('ok');
});
