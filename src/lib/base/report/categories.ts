// Статті витрат для звіту донорам і визначення статті за описом, коли її ще не вказали.
import type { FinanceItem } from '../types';

export const FINANCE_CATEGORIES = ['Запчастини', 'Роботи СТО', 'Фарбування', 'Доставка', 'Пальне', 'Оформлення', 'Інше'] as const;
export type FinanceCategory = (typeof FINANCE_CATEGORIES)[number];

/** Статті, які за домовленістю обов'язково мають бути у звіті (дані дають бухгалтерія й Андрій). */
export const REQUIRED_LOGISTICS: FinanceCategory[] = ['Доставка', 'Пальне', 'Оформлення'];

const L = 'а-яіїєґ'; // кириличні літери для меж слів (\b у JS працює лише з латиницею)
const word = (stem: string, whole = false) => new RegExp(`(?<![${L}])${stem}${whole ? `(?![${L}])` : ''}`, 'iu');

const RULES: [FinanceCategory, RegExp[]][] = [
  ['Пальне', [word('пальн'), word('бензин'), word('заправ'), word('паливо', true), word('дизельне паливо')]],
  ['Доставка', [word('доставк'), word('перег[оі]н'), word('евакуатор'), word('перевез'), word('транспортуван'), word('логістик')]],
  ['Оформлення', [word('оформлен'), word('реєстрац'), word('розмитн'), word('митн'), word('сертифікац'), word('держмит'), word('нотаріус'), word('страхуван'), word('техпаспорт')]],
  ['Фарбування', [word('фарбув'), word('покраск'), word('фарб'), word('малярн')]],
];
const PARTS_EXPLICIT = [word('запчаст'), word('детал')];
const WORK_EXPLICIT = [word('робот'), word('послуг')];
const PARTS_HINT = [word('фільтр'), word('насос'), word('колодк'), word('диск'), word('рем[іе]н'), word('олив'), word('масл'), word('шин'), word('акумулятор'),
  word('свіч'), word('амортизатор'), word('підшипник'), word('комплект'), word('сайлентблок'), word('кульов'), word('радіатор'), word('стартер'),
  word('генератор'), word('форсунк'), word('зчеплен'), word('турбін'), word('грм', true), word('опор')];
const WORK_HINT = [word('ремонт'), word('замін'), word('діагност'), word('шиномонтаж'), word('зварюв'), word('розвал'), word('встановлен'), word('сто', true)];

/** Стаття за описом витрати. `partNames` — назви запчастин цього авто: якщо опис їх згадує, це запчастини. */
export function inferCategory(text: string | null | undefined, partNames: string[] = []): FinanceCategory {
  const t = (text ?? '').trim();
  if (!t) return 'Інше';
  for (const [cat, res] of RULES) if (res.some(r => r.test(t))) return cat;
  if (PARTS_EXPLICIT.some(r => r.test(t))) return 'Запчастини';
  if (WORK_EXPLICIT.some(r => r.test(t))) return 'Роботи СТО';
  const lower = t.toLowerCase();
  if (partNames.some(n => n.trim().length > 3 && lower.includes(n.trim().toLowerCase()))) return 'Запчастини';
  if (PARTS_HINT.some(r => r.test(t))) return 'Запчастини';
  if (WORK_HINT.some(r => r.test(t))) return 'Роботи СТО';
  return 'Інше';
}

/** Стаття рядка: вказана вручну або визначена за описом (тоді inferred = true — керівнику варто перевірити). */
export function categoryOf(f: Pick<FinanceItem, 'category' | 'purpose'>, partNames: string[] = []): { category: string; inferred: boolean } {
  if (f.category) return { category: f.category, inferred: false };
  return { category: inferCategory(f.purpose, partNames), inferred: true };
}
