-- Модуль «Облік авто СТО БАЗА». Схема. Префікс base_.
-- Значення довідників (статуси, типи) живуть у base_ref_values, а не в enum,
-- щоб їх можна було додавати без міграції.

-- ---------- Довідники ----------
create table base_ref_values (
  kind  text not null,
  value text not null,
  sort  int  not null default 0,
  primary key (kind, value)
);

insert into base_ref_values (kind, value, sort) values
  ('vehicle_status','Прийнято',1), ('vehicle_status','Діагностика',2),
  ('vehicle_status','В ремонті',3), ('vehicle_status','Готовий',4),
  ('vehicle_status','Передано частині',5),
  ('vehicle_type','Позашляховик',1), ('vehicle_type','Мікроавтобус',2),
  ('vehicle_type','Пікап',3), ('vehicle_type','Вантажівка',4), ('vehicle_type','Інше',5),
  ('job_status','Заплановано',1), ('job_status','В процесі',2), ('job_status','Завершено',3),
  ('part_status','Замовлено',1), ('part_status','Отримано',2), ('part_status','Встановлено',3),
  ('pay_status','Очікує оплати',1), ('pay_status','Оплачено',2),
  ('fund_source','Збір',1), ('fund_source','Фандрайзинг',2),
  ('delay_risk','Низький',1), ('delay_risk','Середній',2), ('delay_risk','Високий',3);

-- Перевірка значення за довідником. Аргументи тригера: пари колонка, вид.
create function base_enforce_ref() returns trigger language plpgsql as $$
declare i int := 0; col text; k text; val text;
begin
  while i < TG_NARGS loop
    col := TG_ARGV[i]; k := TG_ARGV[i+1];
    val := to_jsonb(NEW) ->> col;
    if val is not null and not exists
       (select 1 from base_ref_values where kind = k and value = val) then
      raise exception 'Недопустиме значення "%" для поля % (довідник %)', val, col, k
        using errcode = '23514';
    end if;
    i := i + 2;
  end loop;
  return NEW;
end $$;

-- Номенклатура: РОБ- (роботи), ЗЧ- (запчастини), ВИТ- (витрати), ДОК- (документи)
create table base_nomenclature (
  id           text primary key,
  kind         text not null check (kind in ('work','part','expense','doc')),
  name         text not null,
  category     text,
  aliases      text,
  planned_days numeric(6,1) check (planned_days >= 0),  -- лише для робіт
  delay_risk   text,                                    -- лише для робіт
  unique (kind, name),
  check (id ~ '^(РОБ|ЗЧ|ВИТ|ДОК)-\d+$')
);
create trigger trg_nom_ref before insert or update on base_nomenclature
  for each row execute function base_enforce_ref('delay_risk','delay_risk');

-- Довідник моделей (картка «типовий план сервісу»)
create table base_ref_models (
  id                  text primary key check (id ~ '^МОД-\d+$'),
  model               text not null unique,
  vehicle_type        text,            -- вільний текст («Пікап», «Буса»…), окремий від типів авто
  engine_fuel         text,
  service_interval    text,
  weak_points         text,
  parts_availability  text,
  intake_checklist    text,
  data_status         text
);

-- ---------- Автомобілі ----------
create table base_vehicles (
  id                text primary key check (id ~ '^АВТО-\d{3}$'),
  name              text not null,
  vehicle_type      text,
  vin               text,
  plate             text,
  status            text not null default 'Прийнято',
  requested_by      text,
  military_unit     text,
  purpose           text,
  received_on       date,
  handed_over_on    date,
  notes             text,
  -- для команди: «що з машиною»
  legacy_links      jsonb,           -- старі посилання з таблиці (Drive), до міграції файлів
  blocker           text,
  next_step         text,
  responsible       text,
  status_updated_at timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (handed_over_on is null or received_on is null or handed_over_on >= received_on)
);
create trigger trg_veh_ref before insert or update on base_vehicles
  for each row execute function base_enforce_ref('status','vehicle_status','vehicle_type','vehicle_type');

-- ---------- Роботи ----------
-- ID_роботи у таблиці — це ID номенклатури (РОБ-001 повторюється по авто),
-- тому власний ключ — сурогатний, а РОБ-… — посилання на номенклатуру.
create table base_jobs (
  id               bigint generated always as identity primary key,
  vehicle_id       text not null references base_vehicles(id) on update cascade,
  nomenclature_id  text references base_nomenclature(id),
  description      text,
  executor         text,
  location         text,
  status           text not null default 'Заплановано',
  started_on       date,
  finished_on      date,
  notes            text,
  import_key       text unique,      -- відбиток рядка xlsx для ідемпотентного імпорту
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (finished_on is null or started_on is null or finished_on >= started_on)
);
create index on base_jobs (vehicle_id);
create index on base_jobs (nomenclature_id);
create trigger trg_job_ref before insert or update on base_jobs
  for each row execute function base_enforce_ref('status','job_status');

-- ---------- Запчастини ----------
-- cost_total — ПІДСУМКОВА вартість рядка (припущення з даних: 4 шт. × 4900 = 19600).
create table base_parts (
  id               bigint generated always as identity primary key,
  vehicle_id       text not null references base_vehicles(id) on update cascade,
  job_id           bigint references base_jobs(id) on delete set null,
  nomenclature_id  text references base_nomenclature(id),
  name             text not null,
  qty              numeric(10,2) not null default 1 check (qty > 0),
  status           text not null default 'Замовлено',
  supplier         text,
  cost_total       numeric(12,2) check (cost_total >= 0),
  ordered_on       date,
  received_on      date,
  notes            text,
  import_key       text unique,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (received_on is null or ordered_on is null or received_on >= ordered_on)
);
create index on base_parts (vehicle_id);
create trigger trg_part_ref before insert or update on base_parts
  for each row execute function base_enforce_ref('status','part_status');

-- ---------- Фінанси (тільки керівники) ----------
-- Борг по особі рахується за person_dejure (колонка «ПІБ_особи ДеЮрЕ»).
create table base_finance (
  id                 bigint generated always as identity primary key,
  -- scope: vehicle = на одне авто; shared = спільний платіж на кілька авто (розподіл потім);
  -- general = не про авто (оренда СТО тощо); unassigned = ще не віднесено (імпорт без ID авто).
  scope              text not null default 'vehicle' check (scope in ('vehicle','shared','general','unassigned')),
  vehicle_id         text references base_vehicles(id) on update cascade,
  amount             numeric(12,2) not null check (amount > 0),
  spent_on           date,
  purpose            text,
  doc_ref            text,           -- текстовий опис документа («Акт №28 …»)
  source             text,
  person_dejure      text,           -- ПІБ особи (де-юре), за якою рахується борг
  contact            text,
  pay_status         text not null default 'Очікує оплати',
  paid_on            date,
  paid_to_dejure     text,
  paid_to_defacto    text,
  invoice_path       text,           -- шлях у Storage (рахунок/акт/платіжка)
  legacy_links       jsonb,          -- старі Drive-посилання з таблиці
  notes              text,
  import_key         text unique,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check ((scope = 'vehicle') = (vehicle_id is not null))
);
create index on base_finance (vehicle_id);
create index on base_finance (person_dejure);
create trigger trg_fin_ref before insert or update on base_finance
  for each row execute function base_enforce_ref('source','fund_source','pay_status','pay_status');

-- ---------- Документи й файли ----------
create table base_documents (
  id               bigint generated always as identity primary key,
  vehicle_id       text not null references base_vehicles(id) on update cascade,
  doc_type_id      text references base_nomenclature(id),   -- ДОК-…
  storage_path     text,             -- порожній, поки файл лише на Drive (legacy_links)
  legacy_links     jsonb,
  doc_date         date,
  uploaded_by      uuid,
  uploaded_by_label text,            -- імпортований текст «Хто_завантажив»
  notes            text,
  import_key       text unique,
  created_at       timestamptz not null default now(),
  check (storage_path is not null or legacy_links is not null)
);
create index on base_documents (vehicle_id);

-- ---------- Журнал змін ----------
create table base_audit_log (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  user_id    uuid,
  table_name text not null,
  op         text not null,
  row_id     text,
  old_row    jsonb,
  new_row    jsonb
);
create index on base_audit_log (table_name, row_id);

create function base_audit() returns trigger language plpgsql security definer as $$
declare rid text;
begin
  rid := coalesce(to_jsonb(NEW) ->> 'id', to_jsonb(OLD) ->> 'id');
  insert into base_audit_log (user_id, table_name, op, row_id, old_row, new_row)
  values (auth.uid(), TG_TABLE_NAME, TG_OP, rid,
          case when TG_OP <> 'INSERT' then to_jsonb(OLD) end,
          case when TG_OP <> 'DELETE' then to_jsonb(NEW) end);
  return coalesce(NEW, OLD);
end $$;

create function base_touch() returns trigger language plpgsql as $$
begin
  NEW.updated_at := now();
  return NEW;
end $$;

create function base_vehicle_status_touch() returns trigger language plpgsql as $$
begin
  if NEW.status is distinct from OLD.status
     or NEW.blocker is distinct from OLD.blocker
     or NEW.next_step is distinct from OLD.next_step
     or NEW.responsible is distinct from OLD.responsible then
    NEW.status_updated_at := now();
  end if;
  return NEW;
end $$;
create trigger trg_veh_status_touch before update on base_vehicles
  for each row execute function base_vehicle_status_touch();

do $$
declare t text;
begin
  foreach t in array array['base_vehicles','base_jobs','base_parts','base_finance'] loop
    execute format('create trigger trg_%s_touch before update on %I for each row execute function base_touch()', t, t);
  end loop;
  foreach t in array array['base_vehicles','base_jobs','base_parts','base_finance',
                           'base_documents','base_nomenclature','base_ref_models','base_ref_values'] loop
    execute format('create trigger trg_%s_audit after insert or update or delete on %I for each row execute function base_audit()', t, t);
  end loop;
end $$;
