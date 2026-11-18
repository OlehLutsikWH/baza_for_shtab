-- ============================================================
-- Права доступу модуля «СТО БАЗА»: RLS + Storage.
-- Залежить від is_member() та is_head() «Штабу» (у автономних тестах — заглушки).
-- Модель:
--   * читання: будь-який член команди (is_member() або is_head());
--   * запис (insert/update/delete): лише керівники «Бази» (base_is_head());
--   * ФІНАНСИ (base_finance, файли в finance/): читає й пише лише base_is_head();
--   * журнал змін base_audit_log: читає лише base_is_head(), напряму не пишеться ніким
--     (пише тригер base_audit() із правами власника);
--   * анонімні користувачі (роль anon) не мають доступу ні до чого.
-- ============================================================

create or replace function base_can_read() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_member() or public.is_head()
$$;
grant execute on function base_can_read() to authenticated;

-- ------------------------------------------------------------
-- Керівники «Бази» (рішення Олега 18.11.2026: керівник — Олег, за потреби ще Андрій).
-- is_head() «Штабу» може охоплювати керівників усього фонду, тому для «Бази» — свій список:
--   * base_heads порожня  → керівники «Бази» = усі керівники «Штабу» (як було);
--   * base_heads заповнена → лише перелічені, і лише поки вони в команді «Штабу».
-- Список змінюють тільки адміністратори (SQL / service role), із застосунку його не видно й не змінити:
--   insert into base_heads (user_id, note) values ('<uuid Олега з auth.users>', 'Олег — координатор');
-- ------------------------------------------------------------
create table base_heads (
  user_id    uuid primary key,
  note       text,
  created_at timestamptz not null default now()
);
alter table base_heads enable row level security;   -- політик немає: з API недоступна нікому
revoke all on base_heads from anon, authenticated;

create or replace function base_is_head() returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from base_heads)
      then exists (select 1 from base_heads where user_id = auth.uid()) and (public.is_member() or public.is_head())
    else public.is_head()
  end
$$;
grant execute on function base_is_head() to authenticated;

do $$
declare t text;
begin
  -- спільні таблиці: читають усі члени, пишуть керівники
  foreach t in array array['base_ref_values','base_nomenclature','base_ref_models','base_vehicles',
                           'base_jobs','base_parts','base_documents'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select to authenticated using (base_can_read())', t || '_sel', t);
    execute format('create policy %I on %I for insert to authenticated with check (base_is_head())', t || '_ins', t);
    execute format('create policy %I on %I for update to authenticated using (base_is_head()) with check (base_is_head())', t || '_upd', t);
    execute format('create policy %I on %I for delete to authenticated using (base_is_head())', t || '_del', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
    execute format('revoke all on %I from anon', t);
  end loop;

  -- фінанси і журнал: усе лише для керівників
  foreach t in array array['base_finance','base_audit_log'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select to authenticated using (base_is_head())', t || '_sel', t);
    execute format('revoke all on %I from anon', t);
  end loop;
  create policy base_finance_ins on base_finance for insert to authenticated with check (base_is_head());
  create policy base_finance_upd on base_finance for update to authenticated using (base_is_head()) with check (base_is_head());
  create policy base_finance_del on base_finance for delete to authenticated using (base_is_head());
  grant select, insert, update, delete on base_finance to authenticated;
  grant select on base_audit_log to authenticated;
end $$;

-- послідовності (bigint id) для insert
do $$
declare s record;
begin
  for s in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where c.relkind = 'S' and n.nspname = 'public' and c.relname like 'base\_%' loop
    execute format('grant usage, select on sequence %I to authenticated', s.relname);
  end loop;
end $$;

-- view: security_invoker, тож RLS таблиць діє; членам фінансові view повернуть порожньо
do $$
declare v text;
begin
  foreach v in array array['base_jobs_v','base_nomenclature_actual','base_debts_by_person','base_spend_by_vehicle',
                           'base_dashboard_counts','base_pending_unattributed'] loop
    execute format('grant select on %I to authenticated', v);
    execute format('revoke all on %I from anon', v);
  end loop;
end $$;

-- ------------------------------------------------------------
-- Storage: приватний bucket base-files.
-- Домовленість про шляхи:  vehicles/<ID авто>/<файл>  — читають усі члени;
--                          finance/<...>               — рахунки, лише керівники.
-- Писати / змінювати / видаляти можуть лише керівники.
-- УВАГА: у «Штабі» перевірити, що bucket-и створюються саме так (storage.buckets) і що
-- політики на storage.objects не конфліктують з наявними.
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('base-files', 'base-files', false)
on conflict (id) do update set public = false;

create policy base_files_sel on storage.objects for select to authenticated
  using (bucket_id = 'base-files'
         and ( (name like 'vehicles/%' and base_can_read()) or (name like 'finance/%' and base_is_head()) ));
create policy base_files_ins on storage.objects for insert to authenticated
  with check (bucket_id = 'base-files' and base_is_head() and (name like 'vehicles/%' or name like 'finance/%'));
create policy base_files_upd on storage.objects for update to authenticated
  using (bucket_id = 'base-files' and base_is_head())
  with check (bucket_id = 'base-files' and base_is_head() and (name like 'vehicles/%' or name like 'finance/%'));
create policy base_files_del on storage.objects for delete to authenticated
  using (bucket_id = 'base-files' and base_is_head());
