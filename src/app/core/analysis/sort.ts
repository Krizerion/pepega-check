export interface SortState {
  key: string;
  dir: 1 | -1;
}

/** Generic column sort; strings compare alphabetically, null/undefined sort last. */
export function sortRows<T>(rows: readonly T[], sort: SortState): T[] {
  return [...rows].sort((a, b) => {
    const av = (a as Record<string, unknown>)[sort.key];
    const bv = (b as Record<string, unknown>)[sort.key];
    if (typeof av === 'string' && typeof bv === 'string') {
      return av.localeCompare(bv) * sort.dir;
    }
    return (((av as number | null) ?? -1) - ((bv as number | null) ?? -1)) * sort.dir;
  });
}

/** Flips direction when re-sorting the same column, else picks a sensible default. */
export function nextSort(current: SortState, key: string): SortState {
  return current.key === key
    ? { key, dir: (current.dir * -1) as 1 | -1 }
    : { key, dir: key === 'name' ? 1 : -1 };
}
