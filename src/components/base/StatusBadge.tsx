const TONE: Record<string, string> = {
  'Прийнято': 'info', 'Діагностика': 'warn', 'В ремонті': 'work', 'Готовий': 'ok', 'Передано частині': 'done',
  'Заплановано': 'info', 'В процесі': 'work', 'Завершено': 'ok', 'Замовлено': 'warn', 'Отримано': 'info', 'Встановлено': 'ok',
  'Очікує оплати': 'warn', 'Оплачено': 'ok',
};
export function StatusBadge({ value }: { value: string }) {
  return <span className={`base-badge base-badge--${TONE[value] ?? 'info'}`}>{value}</span>;
}
