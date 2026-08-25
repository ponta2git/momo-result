export type PaginationState = {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
};

/** Formats the rendered item range once so every pagination surface uses the same scope text. */
export function formatPaginationRange(pagination: PaginationState): string {
  if (pagination.totalItems === 0) {
    return "0件 / 全0件";
  }
  const start = (pagination.page - 1) * pagination.pageSize + 1;
  const end = Math.min(pagination.page * pagination.pageSize, pagination.totalItems);
  return `${start.toLocaleString()}-${end.toLocaleString()}件 / 全${pagination.totalItems.toLocaleString()}件`;
}
