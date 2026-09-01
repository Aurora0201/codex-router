export type PaginationToken = number | "start-ellipsis" | "end-ellipsis"

/**
 * Which page numbers a pager shows, and where it elides. Pure arithmetic over
 * a page and a count, so it is worth having somewhere it can be read and
 * tested without rendering a table around it.
 */
export function paginationTokens(
  page: number,
  totalPages: number
): PaginationToken[] {
  if (totalPages <= 7)
    return Array.from({ length: totalPages }, (_, index) => index + 1)
  if (page <= 4) return [1, 2, 3, 4, 5, "end-ellipsis", totalPages]
  if (page >= totalPages - 3)
    return [
      1,
      "start-ellipsis",
      totalPages - 4,
      totalPages - 3,
      totalPages - 2,
      totalPages - 1,
      totalPages,
    ]
  return [
    1,
    "start-ellipsis",
    page - 1,
    page,
    page + 1,
    "end-ellipsis",
    totalPages,
  ]
}
