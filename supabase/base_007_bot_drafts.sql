-- ============================================================
-- Роботи й запчастини з Telegram-бота: чернетка «додати?», яку керівник підтверджує кнопкою
-- (рішення Олега 18.11.2026: роботи й запчастини додає він сам — через бота або через Claude).
-- Бот працює з ключем service role (повз RLS); читати чернетки можуть лише керівники «Бази».
-- Накочувати після base_006_bot_uploads.sql.
-- ============================================================

create table base_bot_drafts (
  id          bigint generated always as identity primary key,
  telegram_id bigint not null,                    -- хто надіслав
  chat_id     bigint not null,
  kind        text not null check (kind in ('job','part')),
  vehicle_id  text references base_vehicles(id) on update cascade on delete set null,
  payload     jsonb not null,                     -- {text, qty, cost}: опис/назва, кількість, ціна за позицію
  status      text not null default 'pending' check (status in ('pending','saving','done','cancelled')),
  record_id   bigint,                             -- id створеної роботи (base_jobs) чи запчастини (base_parts)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table base_bot_drafts enable row level security;
create policy base_bot_drafts_sel on base_bot_drafts for select to authenticated using (base_is_head());
grant select on base_bot_drafts to authenticated;
revoke all on base_bot_drafts from anon;
