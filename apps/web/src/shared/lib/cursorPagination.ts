export type CursorPagination = {
  page: number;
  totalPages: number;
  previousCursor?: string;
  nextCursor?: string;
  lastCursor?: string;
};

/** Maps numbered navigation onto opaque cursor edges issued by the server. */
export function cursorForPage(
  pagination: CursorPagination,
  targetPage: number,
): string | undefined {
  if (targetPage === pagination.page) return undefined;
  if (targetPage <= 1) return "";
  // Prefer the dedicated reverse-keyset boundary for the last-page jump, including when the last
  // page happens to be adjacent to the current page.
  if (targetPage === pagination.totalPages) return pagination.lastCursor;
  if (targetPage === pagination.page - 1) return pagination.previousCursor;
  if (targetPage === pagination.page + 1) return pagination.nextCursor;
  return undefined;
}
