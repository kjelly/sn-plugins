export type SparseOutlineOptions = {
  maxLevel?: number;
  query?: string;
};

/**
 * Filter an outline index by maximum heading depth and/or search query.
 */
export function filterSparseOutline<T extends { text: string; level: number }>(
  headings: readonly T[],
  options?: SparseOutlineOptions,
): T[] {
  if (!options) return [...headings];

  const { maxLevel, query } = options;
  const trimmedQuery = query?.trim().toLowerCase();

  return headings.filter((heading) => {
    if (maxLevel !== undefined && heading.level > maxLevel) {
      return false;
    }
    if (trimmedQuery && trimmedQuery.length > 0) {
      if (!heading.text.toLowerCase().includes(trimmedQuery)) {
        return false;
      }
    }
    return true;
  });
}
