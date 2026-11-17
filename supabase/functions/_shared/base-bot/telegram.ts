// Клієнт Telegram Bot API для ядра бота: sendMessage, editMessageText, answerCallbackQuery, getFile + завантаження файлу.
import type { BotTelegram, Button } from './core.ts';

export function createTelegram(token: string, fetchFn: typeof fetch = fetch): BotTelegram {
  async function call<T = unknown>(method: string, body: Record<string, unknown>): Promise<T | undefined> {
    const r = await fetchFn(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const j = (await r.json().catch(() => ({}))) as { ok?: boolean; description?: string; result?: T };
    if (!r.ok || j.ok === false) throw new Error(`Telegram ${method}: ${j.description ?? r.status}`);
    return j.result;
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
    async edit(chatId, messageId, html, buttons) {
      try {
        // порожня клавіатура прибирає кнопки зі старого питання
        await call('editMessageText', {
          chat_id: chatId, message_id: messageId, text: html, parse_mode: 'HTML', link_preview_options: { is_disabled: true },
          reply_markup: keyboard(buttons ?? []),
        });
      } catch (e) {
        if (/message is not modified/i.test(String(e))) return; // той самий текст — нічого міняти
        throw e;
      }
    },
    async answerCallback(id, text) { await call('answerCallbackQuery', { callback_query_id: id, ...(text ? { text } : {}) }); },
    async download(fileId) {
      const f = await call<{ file_path?: string }>('getFile', { file_id: fileId });
      if (!f?.file_path) throw new Error('Telegram: файл недоступний');
      // у посиланні на файл є токен бота — в текст помилки його не пишемо
      const r = await fetchFn(`https://api.telegram.org/file/bot${token}/${f.file_path}`);
      if (!r.ok) throw new Error(`Telegram: не вдалося завантажити файл (${r.status})`);
      return new Uint8Array(await r.arrayBuffer());
    },
  };
}
