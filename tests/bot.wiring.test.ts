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
  it('editMessageText: текст, кнопки; без кнопок — порожня клавіатура; «not modified» — не помилка', async () => {
    const calls: { url: string; body: any }[] = [];
    let reply: any = { ok: true };
    const tg = createTelegram('TOKEN', (async (url: string, init: any) => { calls.push({ url, body: JSON.parse(init.body) }); return Response.json(reply, { status: reply.ok ? 200 : 400 }); }) as any);
    await tg.edit(42, 7, 'Збережено', [[{ text: 'Папка', url: 'https://drive' }]]);
    expect(calls[0].url).toBe('https://api.telegram.org/botTOKEN/editMessageText');
    expect(calls[0].body).toMatchObject({ chat_id: 42, message_id: 7, text: 'Збережено', parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: 'Папка', url: 'https://drive' }]] } });
    await tg.edit(42, 7, 'Скасовано');
    expect(calls[1].body.reply_markup).toEqual({ inline_keyboard: [] });
    reply = { ok: false, description: 'Bad Request: message is not modified: specified new message content and reply markup are exactly the same' };
    await expect(tg.edit(42, 7, 'Скасовано')).resolves.toBeUndefined();
    reply = { ok: false, description: 'Bad Request: message to edit not found' };
    await expect(tg.edit(42, 7, 'x')).rejects.toThrow('message to edit not found');
  });
  it('download: getFile → файл за шляхом; токен не потрапляє в текст помилки', async () => {
    const urls: string[] = [];
    const ok = createTelegram('SECRET-TOKEN', (async (url: string) => {
      urls.push(url);
      if (url.endsWith('/getFile')) return Response.json({ ok: true, result: { file_id: 'F', file_path: 'photos/file_9.jpg' } });
      return new Response(new Uint8Array([0xff, 0xd8, 0x00, 0xd9]));
    }) as any);
    expect(Array.from(await ok.download('F'))).toEqual([0xff, 0xd8, 0x00, 0xd9]);
    expect(urls[1]).toBe('https://api.telegram.org/file/botSECRET-TOKEN/photos/file_9.jpg');
    const gone = createTelegram('SECRET-TOKEN', (async (url: string) => url.endsWith('/getFile')
      ? Response.json({ ok: true, result: { file_id: 'F', file_path: 'photos/x.jpg' } }) : new Response('nope', { status: 404 })) as any);
    const err = (await gone.download('F').then(() => null, e => e)) as Error;
    expect(err.message).toBe('Telegram: не вдалося завантажити файл (404)');
    expect(err.message).not.toContain('SECRET-TOKEN');
    const big = createTelegram('T', (async () => Response.json({ ok: false, description: 'Bad Request: file is too big' }, { status: 400 })) as any);
    await expect(big.download('F')).rejects.toThrow('file is too big');
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
  const up = (msg: number, extra = '') => `insert into base_bot_uploads (telegram_id, chat_id, message_id, media_group_id, file_id, mime, sent_at${extra ? ', status, updated_at' : ''})
    values (111, 111, ${msg}, 'alb1', 'F${msg}', 'image/jpeg', now()${extra})`;
  it('фото бота: одне повідомлення — один запис; лише зображення; керівник бачить, член команди — ні', async () => {
    await as('owner');
    await db.exec(up(1)); await db.exec(up(2));
    await expect(db.exec(up(1))).rejects.toThrow(); // Telegram повторив оновлення
    await expect(db.exec(`insert into base_bot_uploads (telegram_id, chat_id, message_id, file_id, mime, sent_at) values (1, 1, 1, 'F', 'application/pdf', now())`)).rejects.toThrow();
    await expect(db.exec(`insert into base_bot_uploads (telegram_id, chat_id, message_id, file_id, mime, sent_at) values (1, 1, 2, 'F', 'image/svg+xml', now())`)).rejects.toThrow();
    await as('head');
    expect((await db.query('select id from base_bot_uploads')).rows).toHaveLength(2);
    await expect(db.exec(`update base_bot_uploads set status = 'saved'`)).rejects.toThrow(/permission denied/); // писати може лише бот
    await as('member');
    expect((await db.query('select id from base_bot_uploads')).rows).toEqual([]);
  });
  it('base_bot_claim_uploads: бере кожне фото один раз; зависле «зберігаю» — знову після тайм-ауту; не для команди', async () => {
    await as('owner');
    await db.exec(`delete from base_bot_uploads`);
    await db.exec(up(10)); await db.exec(up(11)); await db.exec(up(12, `, 'saving', now() - interval '10 minutes'`)); await db.exec(up(13, `, 'saved', now()`));
    const ids = (await db.query<{ id: number }>('select id from base_bot_uploads order by message_id')).rows.map(r => Number(r.id));
    const claim = async () => (await db.query<{ upload_id: number }>(`select upload_id from base_bot_claim_uploads($1::bigint[], now() - interval '5 minutes')`, [ids])).rows.map(r => Number(r.upload_id)).sort();
    expect(await claim()).toEqual([ids[0], ids[1], ids[2]]);
    expect(await claim()).toEqual([]); // друге натискання — нічого
    expect((await db.query(`select status from base_bot_uploads where id = $1`, [ids[3]])).rows).toEqual([{ status: 'saved' }]);
    await as('member');
    await expect(db.query(`select * from base_bot_claim_uploads($1::bigint[], now())`, [ids])).rejects.toThrow(/permission denied/);
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
      for (const m of ['select', 'eq', 'neq', 'in', 'order', 'limit', 'update', 'upsert', 'insert', 'delete']) {
        b[m] = (...args: any[]) => { ops.push(`${m}(${args.map(a => JSON.stringify(a)).join(',')})`); return b; };
      }
      b.then = (ok: any) => {
        const key = `${table}.${ops.join('.')}`;
        log.push(key);
        const err = errors[table]?.(key) ?? null;
        return Promise.resolve({ data: err ? null : (typeof tables[table] === 'function' ? (tables[table] as any)(key) : tables[table] ?? []), error: err }).then(ok);
      };
      return b;
    };
    const rpc = (fn: string, args: any) => { log.push(`rpc:${fn}(${JSON.stringify(args)})`); return Promise.resolve({ data: tables[`rpc:${fn}`] ?? [], error: null }); };
    return { sb: { from, rpc }, log };
  }
  let errors: Record<string, (key: string) => { code?: string; message: string } | null> = {};
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
  it('claim: перший — true, повтор (23505) — false, інша помилка — виняток', async () => {
    const { sb } = fakeSb({ base_bot_log: [{ kind: 'upload-ask' }] });
    const st = createSupabaseBotStore(sb);
    expect(await st.claim('upload-ask', '111:alb1')).toBe(true);
    errors = { base_bot_log: () => ({ code: '23505', message: 'duplicate key' }) };
    expect(await st.claim('upload-ask', '111:alb1')).toBe(false);
    errors = { base_bot_log: () => ({ code: '42501', message: 'permission denied' }) };
    await expect(st.claim('upload-ask', '111:alb1')).rejects.toThrow('permission denied');
    errors = {};
  });
  it('фото: запис (повтор — null), альбом за media_group_id, атомарне взяття через rpc, оновлення лише потрібних', async () => {
    const row = { id: '5', telegram_id: '111', chat_id: '111', message_id: '9', media_group_id: 'alb1', file_id: 'F', file_name: null, mime: 'image/jpeg', file_size: '2048', caption: '021 до', sent_at: '2026-11-18T07:00:00Z', status: 'pending', vehicle_id: null, kind: null, drive_file_id: null, error: null, updated_at: '2026-11-18T07:00:00Z' };
    const { sb, log } = fakeSb({ base_bot_uploads: [row], 'rpc:base_bot_claim_uploads': [{ upload_id: '5' }, { upload_id: 6 }] });
    const st = createSupabaseBotStore(sb);
    const nu = { telegram_id: 111, chat_id: 111, message_id: 9, media_group_id: 'alb1', file_id: 'F', file_name: null, mime: 'image/jpeg', file_size: 2048, caption: '021 до', sent_at: '2026-11-18T07:00:00Z' };
    expect(await st.addUpload(nu)).toMatchObject({ id: 5, chat_id: 111, file_size: 2048, status: 'pending' });
    errors = { base_bot_uploads: k => (k.includes('.insert(') ? { code: '23505', message: 'duplicate key' } : null) };
    expect(await st.addUpload(nu)).toBeNull();
    errors = {};
    expect((await st.uploadGroup(5)).map(u => u.id)).toEqual([5]);
    expect(log.some(l => l.startsWith('base_bot_uploads.select(') && l.includes('.eq("chat_id",111).eq("media_group_id","alb1").order("id")'))).toBe(true);
    expect(await st.claimUploads([5, 6], '2026-11-18T06:55:00.000Z')).toEqual([5, 6]);
    expect(log).toContain('rpc:base_bot_claim_uploads({"p_ids":[5,6],"p_stale_before":"2026-11-18T06:55:00.000Z"})');
    await st.updateUploads([5, 6], { status: 'cancelled' }, 'pending');
    expect(log[log.length - 1]).toMatch(/^base_bot_uploads\.update\(\{"status":"cancelled","updated_at":"[^"]+"\}\)\.in\("id",\[5,6\]\)\.eq\("status","pending"\)\.select\("id"\)$/);
  });
});
