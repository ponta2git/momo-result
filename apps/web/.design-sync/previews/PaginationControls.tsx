import { PaginationControls } from "momo-result-ui";

const noop = () => {};

export const Full = () => (
  <PaginationControls
    onPageChange={noop}
    onPageSizeChange={noop}
    pageSizeOptions={[20, 50, 100]}
    pagination={{
      hasNextPage: true,
      hasPreviousPage: true,
      page: 3,
      pageSize: 20,
      totalItems: 248,
      totalPages: 13,
    }}
  />
);

export const FirstPage = () => (
  <PaginationControls
    onPageChange={noop}
    onPageSizeChange={noop}
    pageSizeOptions={[20, 50, 100]}
    pagination={{
      hasNextPage: true,
      hasPreviousPage: false,
      page: 1,
      pageSize: 50,
      totalItems: 248,
      totalPages: 5,
    }}
  />
);

export const CompactEmbedded = () => (
  <PaginationControls
    ariaLabel="試合結果のページ"
    onPageChange={noop}
    pagination={{
      hasNextPage: true,
      hasPreviousPage: true,
      page: 2,
      pageSize: 10,
      totalItems: 36,
      totalPages: 4,
    }}
    placement="embedded"
    variant="compact"
  />
);

export const Disabled = () => (
  <PaginationControls
    disabled
    onPageChange={noop}
    onPageSizeChange={noop}
    pageSizeOptions={[20, 50, 100]}
    pagination={{
      hasNextPage: true,
      hasPreviousPage: true,
      page: 2,
      pageSize: 20,
      totalItems: 248,
      totalPages: 13,
    }}
  />
);
