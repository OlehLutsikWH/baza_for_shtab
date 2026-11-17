-- ============================================================
-- Фото через Telegram-бота «Бази»: що надіслали і куди поклали (папка авто на Google Drive).
-- Самих фото в базі немає: лише file_id Telegram (щоб завантажити) і id файлу на Drive після збереження.
-- Бот працює з ключем service role (повз RLS); читати журнал можуть лише керівники.
-- У base_bot_log з'являються ще два види записів: upload-ask (питання на альбом поставлено) і album-reply (відмову на альбом надіслано).
-- Накочувати після base_005_bot.sql.
-- ============================================================

create table base_bot_uploads (
  id             bigint generated always as identity primary key,
  telegram_id    bigint not null,                 -- хто надіслав
  chat_id        bigint not null,
  message_id     bigint not null,
  media_group_id text,                            -- альбом: однакове в усіх фото альбому
  file_id        text not null,                   -- Telegram file_id
  file_name      text,                            -- для зображень, надісланих файлом
  mime           text not null check (mime like 'image/%' and mime <> 'image/svg+xml'),
  file_size      bigint,
  caption        text,
  sent_at        timestamptz not null,
  status         text not null default 'pending' check (status in ('pending','saving','saved','cancelled')),
  vehicle_id     text references base_vehicles(id) on update cascade on delete set null,
  kind           text check (kind in ('before','after','other')),   -- До ремонту / Після ремонту / в папку авто
  drive_file_id  text,
  error          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (chat_id, message_id)                    -- Telegram може повторити оновлення: друге не запишеться
);
create index base_bot_uploads_album on base_bot_uploads (chat_id, media_group_id) where media_group_id is not null;

alter table base_bot_uploads enable row level security;
create policy base_bot_uploads_sel on base_bot_uploads for select to authenticated using (public.is_head());
grant select on base_bot_uploads to authenticated;
revoke all on base_bot_uploads from anon;

-- Взяти фото в роботу атомарно: два одночасні натискання «Зберегти» (або повтор від Telegram) не візьмуть
-- те саме фото двічі. «Зберігаю…», що зависло (функцію перервали), після p_stale_before можна взяти знову.
create or replace function base_bot_claim_uploads(p_ids bigint[], p_stale_before timestamptz)
returns table (upload_id bigint)
language sql
as $$
  update base_bot_uploads
     set status = 'saving', updated_at = now(), error = null
   where id = any(p_ids)
     and (status = 'pending' or (status = 'saving' and updated_at < p_stale_before))
  returning id
$$;
revoke execute on function base_bot_claim_uploads(bigint[], timestamptz) from public, anon, authenticated;
