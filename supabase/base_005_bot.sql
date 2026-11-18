-- ============================================================
-- Telegram-бот «Бази»: хто підключений і що вже надіслано (щоб не дублювати нагадування).
-- Бот працює з ключем service role (повз RLS); політики нижче — для майбутнього екрана в «Штабі».
-- Накочувати після base_004_donor_reports.sql.
-- ============================================================

create table base_bot_users (
  telegram_id bigint primary key,
  name        text not null,
  role        text not null check (role in ('head','member')),
  notify      boolean not null default false,   -- отримувати щоденне зведення й «ремонт завершено»
  added_at    timestamptz not null default now()
);

create table base_bot_log (
  kind    text not null,   -- digest | report-ready | join
  ref     text not null,   -- дата зведення / авто@час чернетки / Telegram ID
  sent_at timestamptz not null default now(),
  primary key (kind, ref)
);

alter table base_bot_users enable row level security;
alter table base_bot_log enable row level security;
create policy base_bot_users_sel on base_bot_users for select to authenticated using (base_is_head());
create policy base_bot_users_ins on base_bot_users for insert to authenticated with check (base_is_head());
create policy base_bot_users_upd on base_bot_users for update to authenticated using (base_is_head()) with check (base_is_head());
create policy base_bot_users_del on base_bot_users for delete to authenticated using (base_is_head());
create policy base_bot_log_sel on base_bot_log for select to authenticated using (base_is_head());
grant select, insert, update, delete on base_bot_users to authenticated;
grant select on base_bot_log to authenticated;
revoke all on base_bot_users, base_bot_log from anon;

-- Щогодинний запуск нагадувань (потрібні розширення pg_cron і pg_net). Підставити адресу проєкту й секрет:
-- select cron.schedule('base-reminders', '5 * * * *', $$
--   select net.http_post(
--     url := 'https://<PROJECT>.supabase.co/functions/v1/base-reminders',
--     headers := jsonb_build_object('x-base-cron', '<BASE_CRON_SECRET>', 'Content-Type', 'application/json'),
--     body := '{}'::jsonb)
-- $$);
