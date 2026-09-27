import { useState } from "react";

import { formatPaginationRange } from "@/shared/lib/pagination";
import { Disclosure } from "@/shared/ui/data/Collapsible";
import { DataTable } from "@/shared/ui/data/DataTable";
import type { DataTableProps } from "@/shared/ui/data/DataTable";
import { PaginationControls } from "@/shared/ui/data/PaginationControls";

type DataVizTableProps<Row> = Pick<DataTableProps<Row>, "columns" | "getRowKey" | "rows"> & {
  label: string;
  minWidth: string;
};

/** The immutable chart's exact values, mounted only on demand with a bounded set of row actions. */
export function DataVizTable<Row>(props: DataVizTableProps<Row>) {
  return (
    <Disclosure
      ariaLabel={`${props.label}の数値を表で見る`}
      panelSpacing="sm"
      summary="数値を表で見る"
      triggerVariant="supporting"
    >
      <PaginatedValues {...props} />
    </Disclosure>
  );
}

function PaginatedValues<Row>({
  columns,
  getRowKey,
  label,
  minWidth,
  rows,
}: DataVizTableProps<Row>) {
  const [requestedPage, setPage] = useState(1);
  const pageSize = 25;
  const totalPages = Math.ceil(rows.length / pageSize);
  const page = Math.min(requestedPage, Math.max(1, totalPages));
  const pagination = {
    page,
    pageSize,
    totalPages,
    totalItems: rows.length,
    hasPreviousPage: page > 1,
    hasNextPage: page < totalPages,
  };
  return (
    <div className="grid min-w-0 gap-3">
      {totalPages > 1 ? (
        <>
          <PaginationControls
            ariaLabel={`${label}の数値のページ`}
            pagination={pagination}
            placement="embedded"
            variant="compact"
            onPageChange={setPage}
          />
          <span className="sr-only" role="status">
            {label}: {formatPaginationRange(pagination)}
          </span>
        </>
      ) : null}
      <DataTable
        caption={{ content: `${label}の数値` }}
        columns={columns}
        density="compact"
        emptyState={<p>対象の数値はありません。</p>}
        getRowKey={getRowKey}
        minWidth={minWidth}
        rows={rows.slice((page - 1) * pageSize, page * pageSize)}
      />
    </div>
  );
}
