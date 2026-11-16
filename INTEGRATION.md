# Чекліст інтеграції в «Штаб» (для людини з доступом до репозиторію)

## Звірити перед накочуванням
1. Існують `auth.uid()`, `is_member()`, `is_head()` без аргументів, і повертають boolean. Хто саме потрапляє в `is_head()`?
2. Конвенція міграцій (`supabase/*.sql`, нумерація, імена). Перейменувати файли `base_00N_*` за конвенцією.
3. Чи є таблиці з префіксом `base_`: конфліктів імен не має бути.
4. Версії Next.js 15, React 19, supabase-js: модуль писався під них.
5. Чи використовує «Штаб» Supabase Storage, і яка конвенція bucket / політик.

## Накочувати
Порядок: `base_001_schema.sql` → `base_002_views.sql` → (етап 5) RLS і Storage.
**НЕ накочувати `base_000_standalone_stubs.sql`.**

## Що ще не зроблено
RLS-політики й Storage (етап 5), інтерфейс (етапи 3–4), імпорт з xlsx (етап 2), інструменти для Telegram-бота й нагадування (після MVP).

## Перевірити після накочування (на копії бази)
- не-керівник не бачить `base_finance` і view `base_debts_by_person`, `base_spend_by_vehicle`;
- запис у `base_*` дозволений лише `is_head()`;
- виконати `npm test` локально: тести не залежать від бази «Штабу».


## Етап 3: інтерфейс (список авто + картка)

Копіювати в «Штаб»: `src/app/base/` (layout, cars, car, base.css), `src/components/base/`, `src/lib/base/`, `supabase/base_001_schema.sql`, `base_002_views.sql`.
НЕ копіювати: `supabase/base_000_standalone_stubs.sql`, `src/app/layout.tsx`, `src/app/page.tsx`, `next.config.mjs`, `tsconfig.json` (у «Штабі» свої).
Єдине місце, залежне від «Штабу»: `src/lib/base/host.ts` (клієнт Supabase та ролі). Змінні `NEXT_PUBLIC_SUPABASE_URL/ANON_KEY` — якщо не задані, модуль працює в демо-режимі з вигаданими даними (`?as=member` — вигляд учасника).
Картка авто відкривається як `/base/car/?id=АВТО-001` (static export не підтримує динамічні маршрути без generateStaticParams).
Фінанси приховані для не-керівників на рівні UI **і** запитів (`base_finance` читається лише якщо `is_head()`); справжній захист — RLS (етап 5).
Потрібно TypeScript 5.x (Next 15 не підтримує TypeScript 7).

## Етап 4: зведення, швидке введення, експорт

Нові файли для копіювання: `src/app/base/page.tsx`, `src/app/base/quick/`, `src/components/base/{Dashboard,QuickEntry}.tsx`, `src/lib/base/{dashboard,csv}.ts`. Навігація — у `BaseShell.tsx` (у «Штабі» її замінить власне меню).
Припущення (підтвердити з Олегом): додавати роботи/запчастини можуть лише керівники; експорт — CSV (`;`, BOM, захист від формул), xlsx не робився.
Для RLS (етап 5): INSERT у `base_jobs`/`base_parts` — тільки `is_head()`; `base_finance` — SELECT тільки `is_head()`.
