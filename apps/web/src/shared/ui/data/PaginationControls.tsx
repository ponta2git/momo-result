import { ChevronsLeft, ChevronsRight, ChevronLeft, ChevronRight } from "lucide-react";

import { IconButton } from "@/shared/ui/actions/IconButton";
import { cn } from "@/shared/ui/cn";
import { SelectField } from "@/shared/ui/forms/SelectField";

export type PaginationState = {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
};

type PaginationControlsProps = {
  className?: string;
  disabled?: boolean;
  pageSizeOptions: number[];
  pagination: PaginationState;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
};

function visibleRange(pagination: PaginationState): string {
  if (pagination.totalItems === 0) {
    return "0件 / 全0件";
  }
  const start = (pagination.page - 1) * pagination.pageSize + 1;
  const end = Math.min(pagination.page * pagination.pageSize, pagination.totalItems);
  return `${start.toLocaleString()}-${end.toLocaleString()}件 / 全${pagination.totalItems.toLocaleString()}件`;
}

export function PaginationControls({
  className,
  disabled = false,
  pageSizeOptions,
  pagination,
  onPageChange,
  onPageSizeChange,
}: PaginationControlsProps) {
  const canGoPrevious = pagination.hasPreviousPage && !disabled;
  const canGoNext = pagination.hasNextPage && !disabled;
  const currentPage = pagination.totalPages === 0 ? 1 : pagination.page;
  const totalPages = Math.max(pagination.totalPages, 1);

  return (
    <nav
      aria-label="ページネーション"
      className={cn(
        "grid gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center",
        className,
      )}
    >
      <p className="text-sm font-semibold text-[var(--color-text-secondary)] tabular-nums">
        {visibleRange(pagination)}
      </p>

      <div className="grid gap-3 sm:grid-cols-[auto_auto] sm:items-center">
        <SelectField
          disabled={disabled}
          label="表示件数"
          options={pageSizeOptions.map((value) => ({
            label: `${value.toLocaleString()}件ずつ`,
            value: String(value),
          }))}
          selectClassName="sm:min-w-36"
          value={String(pagination.pageSize)}
          onChange={(event) => {
            onPageSizeChange(Number(event.currentTarget.value));
          }}
        />
        <div className="grid w-full grid-cols-4 items-center gap-2 sm:w-auto sm:grid-cols-[2.5rem_2.5rem_minmax(5rem,auto)_2.5rem_2.5rem] sm:justify-end">
          <IconButton
            aria-label="先頭ページへ"
            className="order-2 sm:order-none"
            disabled={!canGoPrevious}
            icon={<ChevronsLeft />}
            size="sm"
            tooltip="先頭ページへ"
            onClick={() => onPageChange(1)}
          />
          <IconButton
            aria-label="前のページへ"
            className="order-2 sm:order-none"
            disabled={!canGoPrevious}
            icon={<ChevronLeft />}
            size="sm"
            tooltip="前のページへ"
            onClick={() => onPageChange(Math.max(1, pagination.page - 1))}
          />
          <span className="order-1 col-span-4 inline-flex min-h-9 min-w-0 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 text-sm font-semibold text-[var(--color-text-secondary)] tabular-nums sm:order-none sm:col-span-1 sm:min-w-20">
            {currentPage.toLocaleString()} / {totalPages.toLocaleString()}
          </span>
          <IconButton
            aria-label="次のページへ"
            className="order-2 sm:order-none"
            disabled={!canGoNext}
            icon={<ChevronRight />}
            size="sm"
            tooltip="次のページへ"
            onClick={() => onPageChange(Math.min(totalPages, pagination.page + 1))}
          />
          <IconButton
            aria-label="最後のページへ"
            className="order-2 sm:order-none"
            disabled={!canGoNext}
            icon={<ChevronsRight />}
            size="sm"
            tooltip="最後のページへ"
            onClick={() => onPageChange(totalPages)}
          />
        </div>
      </div>
    </nav>
  );
}
