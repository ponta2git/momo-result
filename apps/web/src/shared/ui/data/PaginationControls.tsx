import { ChevronsLeft, ChevronsRight, ChevronLeft, ChevronRight } from "lucide-react";

import { IconButton } from "@/shared/ui/actions/IconButton";
import { cn } from "@/shared/ui/cn";
import { SelectField } from "@/shared/ui/forms/SelectField";
import { formatPaginationRange } from "@/shared/lib/pagination";
import type { PaginationState } from "@/shared/lib/pagination";

type PaginationControlsBaseProps = {
  ariaLabel?: string | undefined;
  className?: string;
  disabled?: boolean;
  pagination: PaginationState;
  onPageChange: (page: number) => void;
};

type FullPaginationControlsProps = PaginationControlsBaseProps & {
  pageSizeOptions: number[];
  variant?: "full" | undefined;
  onPageSizeChange: (pageSize: number) => void;
};

type CompactPaginationControlsProps = PaginationControlsBaseProps & {
  pageSizeOptions?: never;
  variant: "compact";
  onPageSizeChange?: never;
};

export type PaginationControlsProps =
  | CompactPaginationControlsProps
  | FullPaginationControlsProps;

/** Provides either full page-size navigation or a deliberately smaller previous/next contract. */
export function PaginationControls(props: PaginationControlsProps) {
  const {
    ariaLabel = "ページネーション",
    className,
    disabled = false,
    pagination,
    onPageChange,
  } = props;
  const variant = props.variant ?? "full";
  const canGoPrevious = pagination.hasPreviousPage && !disabled;
  const canGoNext = pagination.hasNextPage && !disabled;
  const currentPage = pagination.totalPages === 0 ? 1 : pagination.page;
  const totalPages = Math.max(pagination.totalPages, 1);

  return (
    <nav
      aria-label={ariaLabel}
      className={cn(
        "grid gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center",
        className,
      )}
    >
      <p className="text-sm font-semibold text-[var(--color-text-secondary)] tabular-nums">
        {formatPaginationRange(pagination)}
      </p>

      <div
        className={cn(
          "grid gap-3 sm:items-center",
          variant === "full" ? "sm:grid-cols-[auto_auto]" : "sm:justify-end",
        )}
      >
        {props.variant !== "compact" ? (
          <SelectField
            disabled={disabled}
            label="表示件数"
            options={props.pageSizeOptions.map((value) => ({
              label: `${value.toLocaleString()}件ずつ`,
              value: String(value),
            }))}
            selectClassName="sm:min-w-36"
            value={String(pagination.pageSize)}
            onChange={(event) => {
              props.onPageSizeChange(Number(event.currentTarget.value));
            }}
          />
        ) : null}
        <div
          className={cn(
            "grid w-full items-center gap-2 sm:w-auto sm:justify-end",
            variant === "full"
              ? "grid-cols-4 sm:grid-cols-[2.5rem_2.5rem_minmax(5rem,auto)_2.5rem_2.5rem]"
              : "grid-cols-[2.75rem_minmax(5rem,auto)_2.75rem]",
          )}
        >
          {variant === "full" ? (
            <IconButton
              aria-label="先頭ページへ"
              className="order-2 sm:order-none"
              disabled={!canGoPrevious}
              icon={<ChevronsLeft />}
              size="sm"
              tooltip="先頭ページへ"
              onClick={() => onPageChange(1)}
            />
          ) : null}
          <IconButton
            aria-label="前のページへ"
            className={variant === "full" ? "order-2 sm:order-none" : undefined}
            disabled={!canGoPrevious}
            icon={<ChevronLeft />}
            size="sm"
            tooltip="前のページへ"
            onClick={() => onPageChange(Math.max(1, pagination.page - 1))}
          />
          <span
            className={cn(
              "inline-flex min-h-11 min-w-0 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 text-sm font-semibold text-[var(--color-text-secondary)] tabular-nums sm:min-h-9 sm:min-w-20",
              variant === "full" ? "order-1 col-span-4 sm:order-none sm:col-span-1" : "",
            )}
          >
            {currentPage.toLocaleString()} / {totalPages.toLocaleString()}
          </span>
          <IconButton
            aria-label="次のページへ"
            className={variant === "full" ? "order-2 sm:order-none" : undefined}
            disabled={!canGoNext}
            icon={<ChevronRight />}
            size="sm"
            tooltip="次のページへ"
            onClick={() => onPageChange(Math.min(totalPages, pagination.page + 1))}
          />
          {variant === "full" ? (
            <IconButton
              aria-label="最後のページへ"
              className="order-2 sm:order-none"
              disabled={!canGoNext}
              icon={<ChevronsRight />}
              size="sm"
              tooltip="最後のページへ"
              onClick={() => onPageChange(totalPages)}
            />
          ) : null}
        </div>
      </div>
    </nav>
  );
}
