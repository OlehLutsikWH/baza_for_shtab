// Клієнт Telegram Bot API (sendMessage, answerCallbackQuery) для ядра бота.
import type { BotTelegram, Button } from './core.ts';

export function createTelegram(token: string, fetchFn: typeof fetch = fetch): BotTelegram {
  async function call(method: string, body: Record<string, unknown>) {
    const r = await fetchFn(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const j = (await r.json().catch(() => ({}))) as { ok?: boolean; description?: string };
    if (!r.ok || j.ok === false) throw new Error(`Telegram ${method}: ${j.description ?? r.status}`);
    return j;
  }
  const keyboard = (rows: Button[][]) => ({
    inline_keyboard: rows.map(row => row.map(b => ('url' in b ? { text: b.text, url: b.url } : { text: b.text, callback_data: b.data }))),
  });
  return {
    async send(chatId, html, buttons) {
      await call('sendMessage', {
        chat_id: chatId, text: html, parse_mode: 'HTML', link_preview_options: { is_disabled: true },
        ...(buttons?.length ? { reply_markup: keyboard(buttons) } : {}),
      });
    },
    async answerCallback(id, text) { await call('answerCallbackQuery', { callback_query_id: id, ...(text ? { text } : {}) }); },
  };
}
