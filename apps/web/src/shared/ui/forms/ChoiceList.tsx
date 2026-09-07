import { Check } from "lucide-react";
import { useId } from "react";
import type { ReactNode } from "react";

import { cn } from "@/shared/ui/cn";
import { SpinnerIcon } from "@/shared/ui/feedback/Spinner";
import { readableTextWidthClass } from "@/shared/ui/layout/readableText";
import { contentText, fieldText } from "@/shared/ui/typography";

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
  disabled?: boolean | undefined;
  emptyState?: ReactNode | undefined;
  layout?: "default" | "dialog" | undefined;
  legend: ReactNode;
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
  disabled = false,
  emptyState,
  layout = "default",
  legend,
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
      className="flex min-h-0 min-w-0 flex-col"
      disabled={disabled || pending}
    >
      <legend className={fieldText.label}>{legend}</legend>
      <div
        className={cn(
          "mt-2 min-w-0 divide-y divide-[var(--color-border)] overflow-hidden rounded-sm border border-[var(--color-border)] bg-[var(--color-surface)]",
          layout === "dialog"
            ? "max-h-[min(24rem,55dvh)] min-h-0 flex-1 overflow-y-auto overscroll-contain"
            : "",
        )}
      >
        {options.length === 0 ? (
          <div className={cn(contentText.body, "p-3 text-pretty", readableTextWidthClass)}>
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
                "grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-stretch",
                option.trailingAction ? "divide-x divide-[var(--color-border)]" : "",
                selected ? "bg-[var(--color-surface-selected)]" : "bg-[var(--color-surface)]",
                optionDisabled ? "opacity-65" : "",
              )}
            >
              <label
                className={cn(
                  "grid min-h-11 min-w-0 grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-2 px-3 py-2",
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
                    <SpinnerIcon size="sm" />
                  ) : selected ? (
                    <Check className="size-3.5" strokeWidth={3} />
                  ) : null}
                </span>
                <span className="min-w-0">
                  <span className={cn(fieldText.label, "block text-pretty")}>{option.label}</span>
                  {option.description ? (
                    <span
                      className={cn(
                        contentText.supporting,
                        "mt-1 block text-pretty",
                        readableTextWidthClass,
                      )}
                      id={descriptionId}
                    >
                      {option.description}
                    </span>
                  ) : null}
                </span>
                <span
                  aria-hidden={!selected}
                  className={cn(contentText.supporting, "min-w-12 text-right")}
                >
                  {selected ? selectedLabel : null}
                </span>
              </label>
              {option.trailingAction ? (
                <div className="flex min-h-11 items-center px-1">{option.trailingAction}</div>
              ) : null}
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
