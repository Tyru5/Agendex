/** Plan-list sort orders accepted in the dashboard's `?sort=` URL param. */
export const sortOptions = ['updatedAt', 'createdAt', 'title'] as const;

export type DashboardSort = (typeof sortOptions)[number];

/** The sort the dashboard will use for the current URL (mirrors its nuqs parser). */
export function sortFromSearch(search: string): DashboardSort {
  const sort = new URLSearchParams(search).get('sort');
  return sortOptions.find((option) => option === sort) ?? 'updatedAt';
}
