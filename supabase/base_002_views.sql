-- Представлення. security_invoker: політики RLS застосовуються від імені
-- користувача, тож не-керівник не побачить фінансові агрегати.

create view base_jobs_v with (security_invoker = true) as
select j.*,
       case when j.status = 'Завершено' and j.started_on is not null and j.finished_on is not null
            then j.finished_on - j.started_on end as duration_days
from base_jobs j;

-- Фактичне середнє по номенклатурі робіт (як у таблиці: округлення до 0,1 дня,
-- лише «Завершено» з обома датами). Порівнюємо за nomenclature_id.
create view base_nomenclature_actual with (security_invoker = true) as
select n.id, n.name, n.planned_days, n.delay_risk,
       round(avg(j.duration_days)::numeric, 1) as actual_avg_days,
       count(j.duration_days)                   as completed_jobs
from base_nomenclature n
left join base_jobs_v j on j.nomenclature_id = n.id
where n.kind = 'work'
group by n.id;

-- Борг по особі = сума витрат зі статусом «Очікує оплати» за person_dejure.
create view base_debts_by_person with (security_invoker = true) as
select person_dejure as person, sum(amount) as owed_total, count(*) as items
from base_finance
where pay_status = 'Очікує оплати' and person_dejure is not null and btrim(person_dejure) <> ''
group by person_dejure;

create view base_spend_by_vehicle with (security_invoker = true) as
select v.id as vehicle_id, v.name,
       coalesce(sum(f.amount), 0)                                          as spent_total,
       coalesce(sum(f.amount) filter (where f.pay_status = 'Очікує оплати'), 0) as pending_total,
       coalesce(sum(f.amount) filter (where f.pay_status = 'Оплачено'), 0)      as paid_total
from base_vehicles v
left join base_finance f on f.vehicle_id = v.id
group by v.id, v.name;

create view base_dashboard_counts with (security_invoker = true) as
select r.value as status, count(v.id) as vehicles
from base_ref_values r
left join base_vehicles v on v.status = r.value
where r.kind = 'vehicle_status'
group by r.value, r.sort
order by r.sort;

-- Очікують оплати, але особу не вказано: не потрапляють у base_debts_by_person,
-- тому показуємо окремо, щоб гроші не зникали з очей.
create view base_pending_unattributed with (security_invoker = true) as
select f.id, f.vehicle_id, f.scope, f.amount, f.spent_on, f.purpose, f.doc_ref
from base_finance f
where f.pay_status = 'Очікує оплати' and (f.person_dejure is null or btrim(f.person_dejure) = '');
