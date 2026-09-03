import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import type { HTMLAttributes, ReactNode } from "react";

import type { PaginationState } from "@/shared/lib/pagination";
import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import { PaginationControls } from "@/shared/ui/data/PaginationControls";
import { Dialog } from "@/shared/ui/feedback/Dialog";
import { ChoiceList } from "@/shared/ui/forms/ChoiceList";
import type { ChoiceListOption } from "@/shared/ui/forms/ChoiceList";
import { buildFieldDescribedBy, Field } from "@/shared/ui/forms/Field";
import { StaleShield } from "@/shared/ui/motion/StaleShield";

type ChoicePickerDialogFieldProps = Omit<
  HTMLAttributes<HTMLDivElement>,
  "children" | "className" | "onChange" | "style"
> & {
  disabled?: boolean | undefined;
  emptyState?: ReactNode | undefined;
  error?: ReactNode | undefined;
  label: string;
  name: string;
  options: ChoiceListOption[];
  pagination?: PaginationState | undefined;
  paginationAriaLabel?: string | undefined;
  pending?: boolean | undefined;
  recovery?: boolean | undefined;
  required?: boolean | undefined;
  scopeChanging?: boolean | undefined;
  selectedLabel: ReactNode;
  value?: string | undefined;
  onPageChange?: ((page: number) => void) | undefined;
  onValueChange: (value: string) => void;
};

/**
 * A descriptive single-choice field whose candidates need more context than a native select can
 * expose. The field owns the visible current value, dialog, radio semantics, and optional paging.
 * A read-only candidate request never owns dialog dismissal; scopeChanging keeps the previous
 * page mounted but inert until the requested page is ready.
 */
export function ChoicePickerDialogField({
  disabled = false,
  emptyState = "選べる候補はありません。",
  error,
  label,
  name,
  options,
  pagination,
  paginationAriaLabel,
  pending = false,
  recovery = false,
  required = false,
  scopeChanging = false,
  selectedLabel,
  value,
  onPageChange,
  onValueChange,
  ...fieldProps
}: ChoicePickerDialogFieldProps) {
  const [open, setOpen] = useState(false);
  const fallbackId = useId();
  const triggerId = `${fallbackId}-trigger`;
  const errorId = error ? `${fallbackId}-error` : undefined;

  const selectChoice = (nextValue: string) => {
    onValueChange(nextValue);
    setOpen(false);
  };

  return (
    <Field
      {...fieldProps}
      error={error}
      errorId={errorId}
      htmlFor={triggerId}
      label={label}
      required={required}
    >
      <div
        className={cn(
          "flex min-h-11 min-w-0 items-center gap-2 rounded-sm border bg-[var(--color-surface)] pr-1 pl-3 pointer-fine:min-h-10",
          error ? "border-[var(--color-danger)]" : "border-[var(--color-border)]",
        )}
      >
        <p className="min-w-0 flex-1 text-sm leading-5 font-medium text-pretty text-[var(--color-text-primary)]">
          {selectedLabel}
        </p>
        <div className="shrink-0">
          <Dialog
            contentClassName="flex min-h-0 flex-col overflow-y-hidden"
            open={open}
            popupClassName="overflow-y-hidden"
            surfaceClassName="flex flex-col overflow-y-hidden"
            title={`${label}を選択`}
            trigger={
              <Button
                aria-describedby={buildFieldDescribedBy(errorId)}
                aria-invalid={error ? true : undefined}
                aria-label={`${label}を${recovery ? "選び直す" : "変更"}`}
                disabled={disabled}
                icon={<ChevronDown aria-hidden="true" />}
                id={triggerId}
                size="sm"
                variant={recovery ? "primary" : "secondary"}
              >
                {recovery ? "選び直す" : "変更"}
              </Button>
            }
            onOpenChange={setOpen}
          >
            <div className="grid min-h-0 flex-1">
              <StaleShield
                active={scopeChanging}
                busyLabel={`${label}候補を更新中`}
                fallback={null}
                statusPlacement="top-end"
                strategy="preserve-inert"
              >
                <div className="flex min-h-0 flex-col gap-3">
                  <div className="flex min-h-0 flex-1 flex-col">
                    <ChoiceList
                      disabled={disabled}
                      emptyState={emptyState}
                      layout="dialog"
                      legend={`${label}候補`}
                      name={name}
                      options={options}
                      pending={pending && !scopeChanging}
                      value={value}
                      onValueChange={selectChoice}
                    />
                  </div>

                  {pagination && pagination.totalPages > 1 && onPageChange ? (
                    <div className="shrink-0">
                      <PaginationControls
                        ariaLabel={paginationAriaLabel ?? `${label}候補のページネーション`}
                        disabled={disabled || (pending && !scopeChanging)}
                        pagination={pagination}
                        placement="embedded"
                        variant="compact"
                        onPageChange={onPageChange}
                      />
                    </div>
                  ) : null}
                </div>
              </StaleShield>
            </div>
          </Dialog>
        </div>
      </div>
    </Field>
  );
}
