// Фото з Google Drive у звіті: шлях «drive:<id>» і підказка «до/після» з назви підпапки.
export const drivePath = (id: string) => `drive:${id}`;
export const driveIdOf = (path: string): string | null => (path.startsWith('drive:') ? path.slice(6) : null);

const L = 'а-яіїєґ';
/** «До ремонту» → «до», «Після» → «після»; інакше null. */
export function kindFromGroup(group: string | null | undefined): 'до' | 'після' | null {
  const g = (group ?? '').trim();
  if (!g) return null;
  if (new RegExp(`(?<![${L}])після(?![${L}])`, 'iu').test(g)) return 'після';
  if (new RegExp(`(?<![${L}])до(?![${L}])`, 'iu').test(g)) return 'до';
  return null;
}
