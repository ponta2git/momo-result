import { cn } from "@/shared/ui/cn";

type SegmentedOption = {
  disabled?: boolean;
  label: string;
  value: string;
};

export type SegmentedControlProps = {
  disabled?: boolean | undefined;
  label?: string;
  onValueChange: (value: string) => void;
  options: SegmentedOption[];
  value: string;
};

export function SegmentedControl({
  disabled = false,
  label = "選択",
  onValueChange,
  options,
  value,
}: SegmentedControlProps) {
  return (
    <fieldset className="inline-flex max-w-full min-w-0 flex-wrap items-stretch gap-1 rounded-sm border border-[var(--color-border)] bg-[var(--color-surface)] p-1">
      <legend className="sr-only">{label}</legend>
      {options.map((option) => {
        return (
          <SegmentedButton
            key={option.value}
            option={option}
            disabled={disabled || option.disabled}
            selected={option.value === value}
            onValueChange={onValueChange}
          />
        );
      })}
    </fieldset>
  );
}

function SegmentedButton({
  disabled,
  option,
  selected,
  onValueChange,
}: {
  disabled: boolean | undefined;
  option: SegmentedOption;
  selected: boolean;
  onValueChange: (value: string) => void;
}) {
  return (
    <button
      aria-pressed={selected}
      className={cn(
        "min-h-11 min-w-[5ch] rounded-xs px-3 py-2 text-sm font-medium text-[var(--color-text-secondary)] focus-visible:-outline-offset-3 pointer-fine:min-h-9 pointer-fine:py-1",
        selected
          ? "bg-[var(--color-surface-selected)] text-[var(--color-text-primary)]"
          : "hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]",
        "disabled:cursor-not-allowed disabled:opacity-50",
      )}
      disabled={disabled}
      type="button"
      onClick={() => onValueChange(option.value)}
    >
      {option.label}
    </button>
  );
}
