-- ============================================================
-- ТІЛЬКИ ДЛЯ АВТОНОМНОЇ РОЗРОБКИ ТА ТЕСТІВ. НЕ НАКОЧУВАТИ У «ШТАБІ».
-- У «Штабі» вже є auth.uid(), is_member(), is_head(). Цей файл
-- імітує їх за тими самими іменами, щоб модуль працював окремо.
-- Перед інтеграцією звірити сигнатури й семантику (див. INTEGRATION.md).
-- ============================================================
create schema if not exists auth;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end $$;

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create table if not exists public.stub_members (
  user_id uuid primary key,
  is_head boolean not null default false
);

create or replace function public.is_member() returns boolean
language sql stable security definer as $$
  select exists (select 1 from public.stub_members where user_id = auth.uid())
$$;

create or replace function public.is_head() returns boolean
language sql stable security definer as $$
  select exists (select 1 from public.stub_members where user_id = auth.uid() and is_head)
$$;

grant usage on schema public, auth to authenticated;
grant execute on function auth.uid(), public.is_member(), public.is_head() to authenticated;

-- Мінімальна імітація Supabase Storage для перевірки політик (у «Штабі» схема storage є).
create schema if not exists storage;
create table if not exists storage.buckets (id text primary key, name text not null, public boolean default false);
create table if not exists storage.objects (id bigint generated always as identity primary key, bucket_id text references storage.buckets(id), name text not null);
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated;
grant select, insert, update, delete on storage.objects to authenticated;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
end $$;
grant usage on schema public to anon;
