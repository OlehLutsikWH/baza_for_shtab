// Обгортки бота: клієнт Telegram (формат запитів) і таблиці бота в базі (RLS).
import { describe, it, expect, beforeAll } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createTelegram } from '../supabase/functions/_shared/base-bot/telegram';
import { freshDb, seed } from './helpers';

describe('Telegram-клієнт', () => {
  it('sendMessage: HTML, без прев’ю, кнопки callback і url', async () => {
    const calls: { url: string; body: any }[] = [];
    const tg = createTelegram('TOKEN', (async (url: string, init: any) => { calls.push({ url, body: JSON.parse(init.body) }); return Response.json({ ok: true }); }) as any);
    await tg.send(42, '<b>Привіт</b>', [[{ text: 'Без змін', data: 'ok:АВТО-001' }, { text: 'Відкрити', url: 'https://x' }]]);
    expect(calls[0].url).toBe('https://api.telegram.org/botTOKEN/sendMessage');
    expect(calls[0].body).toEqual({ chat_id: 42, text: '<b>Привіт</b>', parse_mode: 'HTML', link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: [[{ text: 'Без змін', callback_data: 'ok:АВТО-001' }, { text: 'Відкрити', url: 'https://x' }]] } });
    await tg.answerCallback('cb1', 'Збережено');
    expect(calls[1].body).toEqual({ callback_query_id: 'cb1', text: 'Збережено' });
  });
  it('помилка Telegram — виняток з описом', async () => {
    const tg = createTelegram('T', (async () => Response.json({ ok: false, description: 'Forbidden: bot was blocked by the user' }, { status: 403 })) as any);
    await expect(tg.send(1, 'x')).rejects.toThrow('bot was blocked');
  });
});

describe('таблиці бота', () => {
  const HEAD = '00000000-0000-0000-0000-0000000000a1', MEMBER = '00000000-0000-0000-0000-0000000000b2';
  let db: PGlite;
  const as = async (who: 'head' | 'member' | 'owner') => {
    await db.exec('reset role');
    if (who === 'owner') return;
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [who === 'head' ? HEAD : MEMBER]);
    await db.exec('set role authenticated');
  };
  beforeAll(async () => {
    db = await freshDb(); await seed(db);
    await db.exec(`insert into stub_members values ('${HEAD}', true), ('${MEMBER}', false);
      insert into base_bot_users values (111, 'Олег', 'head', true), (222, 'Іван', 'member', false);
      insert into base_bot_log (kind, ref) values ('digest', '2026-11-18');`);
  });
  it('керівник бачить і змінює користувачів бота; член команди — ні', async () => {
    await as('head');
    expect((await db.query('select * from base_bot_users')).rows).toHaveLength(2);
    await db.exec(`update base_bot_users set notify = true where telegram_id = 222`);
    await as('member');
    expect((await db.query('select * from base_bot_users')).rows).toEqual([]);
    expect((await db.query('select * from base_bot_log')).rows).toEqual([]);
  });
  it('журнал не дублює одне й те саме нагадування', async () => {
    await as('owner');
    await expect(db.exec(`insert into base_bot_log (kind, ref) values ('digest', '2026-11-18')`)).rejects.toThrow();
  });
});

describe('сховище бота на supabase-js', async () => {
  const { createSupabaseBotStore } = await import('../supabase/functions/_shared/base-bot/store-supabase');
  // імітація ланцюжка запитів supabase-js: записує виклики, повертає дані за таблицею
  function fakeSb(tables: Record<string, any[]>) {
    const log: string[] = [];
    const from = (table: string) => {
      const ops: string[] = [];
      const b: any = {};
      for (const m of ['select', 'eq', 'neq', 'order', 'limit', 'update', 'upsert', 'delete']) {
        b[m] = (...args: any[]) => { ops.push(`${m}(${args.map(a => JSON.stringify(a)).join(',')})`); return b; };
      }
      b.then = (ok: any) => { log.push(`${table}.${ops.join('.')}`); return Promise.resolve({ data: tables[table] ?? [], error: null }).then(ok); };
      return b;
    };
    return { sb: { from }, log };
  }
  it('авто з лічильниками робіт і запчастин; гроші в копійках без похибки', async () => {
    const { sb } = fakeSb({
      base_vehicles: [{ id: 'АВТО-001', name: 'А', status: 'В ремонті', blocker: null, next_step: null, responsible: null, status_updated_at: '2026-11-01T00:00:00Z', military_unit: null }],
      base_jobs: [{ vehicle_id: 'АВТО-001' }, { vehicle_id: 'АВТО-001' }],
      base_parts: [{ vehicle_id: 'АВТО-001' }],
      base_finance: [{ amount: '0.10', pay_status: 'Оплачено' }, { amount: '0.20', pay_status: 'Очікує оплати' }],
    });
    const st = createSupabaseBotStore(sb);
    expect((await st.vehicles())[0]).toMatchObject({ open_jobs: 2, parts_waiting: 1 });
    expect(await st.vehicleMoney('АВТО-001')).toEqual({ total: 0.3, pending: 0.2 });
  });
  it('статус, «без змін», користувачі й журнал — правильні запити', async () => {
    const { sb, log } = fakeSb({ base_bot_log: [], base_bot_users: [{ telegram_id: '111', name: 'Олег', role: 'head', notify: true }] });
    const st = createSupabaseBotStore(sb);
    await st.setStatus('АВТО-001', 'Готовий');
    await st.confirmNoChange('АВТО-001');
    expect(await st.wasSent('digest', '2026-11-18')).toBe(false);
    await st.markSent('digest', '2026-11-18');
    expect((await st.users())[0].telegram_id).toBe(111);
    expect(log[0]).toBe('base_vehicles.update({"status":"Готовий"}).eq("id","АВТО-001").select("id")');
    expect(log[1]).toMatch(/^base_vehicles\.update\(\{"status_updated_at":"[^"]+"\}\)\.eq\("id","АВТО-001"\)/);
    expect(log).toContain('base_bot_log.upsert({"kind":"digest","ref":"2026-11-18"},{"onConflict":"kind,ref"}).select("kind")');
  });
});
