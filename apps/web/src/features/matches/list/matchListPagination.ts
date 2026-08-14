import type { MatchListResponse } from "@/shared/api/matches";

type MatchPagination = MatchListResponse["pagination"];

/** Maps the existing numbered navigation UX onto the server-issued opaque cursor edges. */
export function cursorForMatchPage(
  pagination: MatchPagination,
  targetPage: number,
): string | undefined {
  if (targetPage === pagination.page) return undefined;
  if (targetPage <= 1) return "";
  // Prefer the dedicated reverse-keyset boundary for the last-page jump, including when the last
  // page happens to be adjacent to the current page.
  if (targetPage === pagination.totalPages) return pagination.lastCursor ?? undefined;
  if (targetPage === pagination.page - 1) return pagination.previousCursor ?? undefined;
  if (targetPage === pagination.page + 1) return pagination.nextCursor ?? undefined;
  return undefined;
}
