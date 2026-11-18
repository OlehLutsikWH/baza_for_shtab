-- ============================================================
-- Звіт для донорів по завершеному авто.
--  * base_finance.category — стаття витрати (для розділу «на що витрачено»);
--  * base_donor_reports — що керівник дописав до звіту (історія, подяка, підписи рахунків, фото)
--    і де лежить сформований PDF;
--  * коли статус авто стає «Готовий» або «Передано частині», автоматично з'являється чернетка звіту.
-- Доступ: лише керівники (звіт побудований на фінансах).
-- Накочувати після base_003_rls.sql.
-- ============================================================

insert into base_ref_values (kind, value, sort) values
  ('finance_category','Запчастини',1), ('finance_category','Роботи СТО',2), ('finance_category','Фарбування',3),
  ('finance_category','Доставка',4), ('finance_category','Пальне',5), ('finance_category','Оформлення',6),
  ('finance_category','Інше',7)
on conflict do nothing;

alter table base_finance add column if not exists category text;

-- довідник для нової колонки: перевизначаємо тригер перевірки значень
drop trigger if exists trg_fin_ref on base_finance;
create trigger trg_fin_ref before insert or update on base_finance
  for each row execute function base_enforce_ref('source','fund_source','pay_status','pay_status','category','finance_category');

create table base_donor_reports (
  vehicle_id    text primary key references base_vehicles(id) on update cascade on delete cascade,
  status        text not null default 'Чернетка' check (status in ('Чернетка','Сформовано')),
  story         text,                                  -- історія машини; порожньо = складається з даних
  thanks        text,                                  -- подяка; порожньо = стандартна
  unit_label    text,                                  -- як назвати підрозділ у звіті; порожньо = base_vehicles.military_unit
  show_unit     boolean not null default true,
  show_invoices boolean not null default true,
  row_labels    jsonb not null default '{}'::jsonb,    -- {"<id витрати>": "текст для донорів"}
  photo_paths   jsonb not null default '[]'::jsonb,    -- [{"path": "vehicles/АВТО-001/x.jpg", "caption": "...", "kind": "до"|"після"}]
  storage_path  text,                                  -- finance/reports/<ID>/<файл>.pdf
  generated_at  timestamptz,
  generated_by  uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger trg_base_donor_reports_touch before update on base_donor_reports
  for each row execute function base_touch();
create trigger trg_base_donor_reports_audit after insert or update or delete on base_donor_reports
  for each row execute function base_audit();

alter table base_donor_reports enable row level security;
create policy base_donor_reports_sel on base_donor_reports for select to authenticated using (base_is_head());
create policy base_donor_reports_ins on base_donor_reports for insert to authenticated with check (base_is_head());
create policy base_donor_reports_upd on base_donor_reports for update to authenticated using (base_is_head()) with check (base_is_head());
create policy base_donor_reports_del on base_donor_reports for delete to authenticated using (base_is_head());
grant select, insert, update, delete on base_donor_reports to authenticated;
revoke all on base_donor_reports from anon;

-- Ремонт завершено → чернетка звіту (якщо ще немає). Статуси збігаються з FINAL_STATUSES у src/lib/base/format.ts.
create or replace function base_vehicle_report_draft() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if NEW.status in ('Готовий','Передано частині')
     and (TG_OP = 'INSERT' or OLD.status is distinct from NEW.status) then
    insert into base_donor_reports (vehicle_id) values (NEW.id) on conflict (vehicle_id) do nothing;
  end if;
  return NEW;
end $$;
create trigger trg_veh_report_draft after insert or update of status on base_vehicles
  for each row execute function base_vehicle_report_draft();

-- Зведення для керівника: завершені авто, по яких звіт ще не сформовано.
create view base_reports_pending with (security_invoker = true) as
select r.vehicle_id, v.name, v.status, r.status as report_status, r.created_at
from base_donor_reports r join base_vehicles v on v.id = r.vehicle_id
where r.status = 'Чернетка';
grant select on base_reports_pending to authenticated;
revoke all on base_reports_pending from anon;
