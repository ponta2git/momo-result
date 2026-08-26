import { Check, LoaderCircle } from "lucide-react";
import { useId } from "react";
import type { ReactNode } from "react";

import { cn } from "@/shared/ui/cn";

export type ChoiceListOption<Value extends string = string> = {
  accessibleLabel?: string | undefined;
  description?: ReactNode | undefined;
  disabled?: boolean | undefined;
  label: ReactNode;
  pending?: boolean | undefined;
  trailingAction?: ReactNode | undefined;
  value: Value;
};

export type ChoiceListProps<Value extends string = string> = {
  className?: string | undefined;
  disabled?: boolean | undefined;
  emptyState?: ReactNode | undefined;
  legend: ReactNode;
  listClassName?: string | undefined;
  name: string;
  options: Array<ChoiceListOption<Value>>;
  pending?: boolean | undefined;
  selectedLabel?: ReactNode | undefined;
  value?: Value | undefined;
  onValueChange: (value: Value) => void;
};

/**
 * Presents descriptive, mutually exclusive choices. It owns native radio semantics,
 * selected/pending feedback, and keeps option-specific actions outside the radio label.
 */
export function ChoiceList<Value extends string>({
  className,
  disabled = false,
  emptyState,
  legend,
  listClassName,
  name,
  options,
  pending = false,
  selectedLabel = "選択中",
  value,
  onValueChange,
}: ChoiceListProps<Value>) {
  const groupId = useId();

  return (
    <fieldset
      aria-busy={pending || undefined}
      className={cn("min-w-0", className)}
      disabled={disabled || pending}
    >
      <legend className="text-sm leading-5 font-semibold text-[var(--color-text-primary)]">
        {legend}
      </legend>
      <div
        className={cn(
          "mt-2 min-w-0 overflow-hidden rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)]",
          listClassName,
        )}
      >
        {options.length === 0 ? (
          <div className="p-3 text-sm text-pretty text-[var(--color-text-secondary)]">
            {emptyState ?? "選べる候補はありません。"}
          </div>
        ) : null}
        {options.map((option, index) => {
          const selected = option.value === value;
          const optionDisabled = disabled || pending || option.disabled || option.pending;
          const descriptionId = option.description ? `${groupId}-${index}-description` : undefined;

          return (
            <div
              key={option.value}
              aria-busy={option.pending || undefined}
              className={cn(
                "grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-stretch border-b border-[var(--color-border)] last:border-b-0",
                selected ? "bg-[var(--color-surface-selected)]" : "bg-[var(--color-surface)]",
                optionDisabled ? "opacity-65" : "",
              )}
            >
              <label
                className={cn(
                  "momo-pressable grid min-h-11 min-w-0 grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-2 px-3 py-2",
                  optionDisabled
                    ? "cursor-not-allowed"
                    : "cursor-pointer hover:bg-[var(--color-surface-hover)]",
                  "has-[:focus-visible]:outline-3 has-[:focus-visible]:-outline-offset-3 has-[:focus-visible]:outline-[var(--color-action)]",
                )}
              >
                <input
                  aria-describedby={descriptionId}
                  aria-label={option.accessibleLabel}
                  checked={selected}
                  className="sr-only"
                  disabled={optionDisabled}
                  name={name}
                  type="radio"
                  value={option.value}
                  onChange={() => onValueChange(option.value)}
                />
                <span
                  aria-hidden="true"
                  className={cn(
                    "inline-flex size-5 items-center justify-center rounded-full border",
                    selected
                      ? "border-[var(--color-action)] text-[var(--color-action)]"
                      : "border-[var(--color-border-strong)] text-transparent",
                  )}
                >
                  {option.pending ? (
                    <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" />
                  ) : selected ? (
                    <Check className="size-3.5" strokeWidth={3} />
                  ) : null}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-pretty text-[var(--color-text-primary)]">
                    {option.label}
                  </span>
                  {option.description ? (
                    <span
                      className="mt-0.5 block text-xs leading-5 text-pretty text-[var(--color-text-secondary)]"
                      id={descriptionId}
                    >
                      {option.description}
                    </span>
                  ) : null}
                </span>
                <span
                  aria-hidden={!selected}
                  className="min-w-12 text-right text-xs font-semibold text-[var(--color-text-secondary)]"
                >
                  {selected ? selectedLabel : null}
                </span>
              </label>
              {option.trailingAction ? (
                <div className="flex min-h-11 items-center border-l border-[var(--color-border)] px-1">
                  {option.trailingAction}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
