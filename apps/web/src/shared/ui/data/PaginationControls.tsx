import { ChevronsLeft, ChevronsRight, ChevronLeft, ChevronRight } from "lucide-react";

import { formatPaginationRange } from "@/shared/lib/pagination";
import type { PaginationState } from "@/shared/lib/pagination";
import { IconButton } from "@/shared/ui/actions/IconButton";
import { cn } from "@/shared/ui/cn";
import { SelectField } from "@/shared/ui/forms/SelectField";

type PaginationControlsBaseProps = {
  ariaLabel?: string | undefined;
  disabled?: boolean;
  pagination: PaginationState;
  placement?: "embedded" | "standalone" | undefined;
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

export type PaginationControlsProps = CompactPaginationControlsProps | FullPaginationControlsProps;

/** Provides either full page-size navigation or a deliberately smaller previous/next contract. */
export function PaginationControls(props: PaginationControlsProps) {
  const {
    ariaLabel = "ページネーション",
    disabled = false,
    pagination,
    placement = "standalone",
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
        "@container/pagination flex min-w-0 flex-wrap items-end gap-4",
        placement === "standalone"
          ? "rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
          : "bg-transparent",
      )}
    >
      <p className="font-plain w-full min-w-0 text-sm text-[var(--color-text-secondary)] tabular-nums @2xl/pagination:me-auto @2xl/pagination:inline-flex @2xl/pagination:min-h-11 @2xl/pagination:w-auto @2xl/pagination:items-center">
        {formatPaginationRange(pagination)}
      </p>

      <div
        className={cn(
          "grid w-full min-w-0 gap-3 @2xl/pagination:w-auto",
          variant === "full"
            ? "@2xl/pagination:grid-cols-[auto_auto] @2xl/pagination:items-end"
            : "@2xl/pagination:items-center @2xl/pagination:justify-end",
        )}
      >
        {props.variant === "compact" ? null : (
          <div className="min-w-0 @2xl/pagination:min-w-36">
            <SelectField
              disabled={disabled}
              label="表示件数"
              options={props.pageSizeOptions.map((value) => ({
                label: `${value.toLocaleString()}件ずつ`,
                value: String(value),
              }))}
              value={String(pagination.pageSize)}
              onValueChange={(nextValue) => {
                props.onPageSizeChange(Number(nextValue));
              }}
            />
          </div>
        )}
        <div
          className={cn(
            "grid w-full min-w-0 items-center gap-2 @2xl/pagination:w-auto @2xl/pagination:justify-end",
            variant === "full"
              ? "grid-cols-4 @2xl/pagination:grid-cols-[2.75rem_2.75rem_minmax(5.5rem,auto)_2.75rem_2.75rem]"
              : "grid-cols-[2.75rem_minmax(5rem,auto)_2.75rem]",
          )}
        >
          {variant === "full" ? (
            <div className="order-2 grid @2xl/pagination:order-none">
              <IconButton
                aria-label="先頭ページへ"
                disabled={!canGoPrevious}
                icon={<ChevronsLeft />}
                size="sm"
                tooltip="先頭ページへ"
                onClick={() => onPageChange(1)}
              />
            </div>
          ) : null}
          <div className={variant === "full" ? "order-2 grid @2xl/pagination:order-none" : "grid"}>
            <IconButton
              aria-label="前のページへ"
              disabled={!canGoPrevious}
              icon={<ChevronLeft />}
              size="sm"
              tooltip="前のページへ"
              onClick={() => onPageChange(Math.max(1, pagination.page - 1))}
            />
          </div>
          <span
            className={cn(
              "inline-flex min-h-11 min-w-0 items-center justify-center rounded-sm border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 text-sm font-plain text-[var(--color-text-secondary)] tabular-nums @2xl/pagination:min-w-22",
              variant === "full"
                ? "order-1 col-span-4 @2xl/pagination:order-none @2xl/pagination:col-span-1"
                : "",
            )}
          >
            {currentPage.toLocaleString()}／{totalPages.toLocaleString()}
          </span>
          <div className={variant === "full" ? "order-2 grid @2xl/pagination:order-none" : "grid"}>
            <IconButton
              aria-label="次のページへ"
              disabled={!canGoNext}
              icon={<ChevronRight />}
              size="sm"
              tooltip="次のページへ"
              onClick={() => onPageChange(Math.min(totalPages, pagination.page + 1))}
            />
          </div>
          {variant === "full" ? (
            <div className="order-2 grid @2xl/pagination:order-none">
              <IconButton
                aria-label="最後のページへ"
                disabled={!canGoNext}
                icon={<ChevronsRight />}
                size="sm"
                tooltip="最後のページへ"
                onClick={() => onPageChange(totalPages)}
              />
            </div>
          ) : null}
        </div>
      </div>
    </nav>
  );
}
