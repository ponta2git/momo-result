import { Select } from "@base-ui/react/select";
import { Check, ChevronDown } from "lucide-react";
import { useIsPresent } from "motion/react";
import { useEffect, useState } from "react";
import type { ComponentPropsWithRef } from "react";

import { cn } from "@/shared/ui/cn";
import { useDialogFloatingContainer } from "@/shared/ui/feedback/DialogFloatingContainer";
import { controlClassName } from "@/shared/ui/forms/controlPresentation";
import type { ControlPresentationProps } from "@/shared/ui/forms/controlPresentation";
import { useSurfaceFeedback } from "@/shared/ui/motion/useSurfaceFeedback";

export type SelectOption = { disabled?: boolean | undefined; label: string; value: string };

type TriggerProps = Pick<
  ComponentPropsWithRef<"button">,
  | "id"
  | "ref"
  | "aria-label"
  | "aria-labelledby"
  | "aria-describedby"
  | "onFocus"
  | "onBlur"
  | "onKeyDown"
  | "autoFocus"
>;

export type SelectValueProps =
  | { value: string; defaultValue?: never }
  | { value?: undefined; defaultValue?: string | undefined };

export type SelectControlProps = ControlPresentationProps &
  TriggerProps & {
    "data-validation-path"?: string | undefined;
    disabled?: boolean | undefined;
    form?: string | undefined;
    name?: string | undefined;
    required?: boolean | undefined;
    options: readonly SelectOption[];
    onValueChange?: ((value: string) => void) | undefined;
  } & SelectValueProps;

function SelectOptionRow({ option }: { option: SelectOption }) {
  const surfaceRef = useSurfaceFeedback<HTMLElement>();
  return (
    <Select.Item
      ref={surfaceRef}
      disabled={option.disabled}
      label={option.label}
      data-value={option.value}
      value={option.value}
      className={({ selected }) =>
        cn(
          "momo-select-option momo-surface flex min-h-11 cursor-default items-center gap-2 rounded-xs px-3 py-2 text-base leading-6 font-plain text-[var(--color-text-primary)] sm:text-sm sm:leading-5 pointer-fine:min-h-10",
          selected && "momo-surface-selected",
        )
      }
    >
      <span aria-hidden="true" className="flex size-4 shrink-0 items-center justify-center">
        <Select.ItemIndicator>
          <Check className="size-4" />
        </Select.ItemIndicator>
      </span>
      <Select.ItemText className="min-w-0 break-words">{option.label}</Select.ItemText>
    </Select.Item>
  );
}

/**
 * Single string selection. Only committed changes reach consumers; empty strings retain
 * their option label. Ref/field attributes belong to the visible trigger, not the form input.
 * onKeyDown exposes only closed-trigger keys not owned by selection (e.g. grid navigation).
 */
export function SelectControl({
  controlHeight = "default",
  density = "default",
  invalid = false,
  textAlign = "start",
  tone = "default",
  defaultValue = "",
  value,
  options,
  onValueChange,
  disabled = false,
  form,
  name,
  required,
  onKeyDown,
  ref,
  ...triggerProps
}: SelectControlProps) {
  const [internalValue, setInternalValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [formInput, setFormInput] = useState<HTMLInputElement | null>(null);
  const present = useIsPresent();
  const container = useDialogFloatingContainer();
  const controlled = value !== undefined;
  const selectedValue = value ?? internalValue;
  const surfaceRef = useSurfaceFeedback(ref);
  const selectedLabel =
    options.find((option) => option.value === selectedValue)?.label ?? "選択内容を確認";

  // HTML reset does not reset a custom control's React state. Follow the owning form,
  // including external form association, without notifying business change handlers.
  useEffect(() => {
    const owner = form ? formInput?.ownerDocument.getElementById(form) : formInput?.form;
    if (!(owner instanceof HTMLFormElement) || controlled) return;
    const reset = (event: Event) => {
      queueMicrotask(() => {
        if (!event.defaultPrevented) {
          setInternalValue(defaultValue);
          setOpen(false);
        }
      });
    };
    owner.addEventListener("reset", reset);
    return () => owner.removeEventListener("reset", reset);
  }, [controlled, defaultValue, formInput, form]);

  return (
    <Select.Root<string>
      disabled={disabled}
      form={form}
      name={name}
      required={required}
      inputRef={setFormInput}
      items={options}
      value={selectedValue}
      open={open && present && !disabled}
      onOpenChange={setOpen}
      onValueChange={(next) => {
        if (next === null || next === selectedValue) return;
        if (!controlled) setInternalValue(next);
        onValueChange?.(next);
      }}
    >
      <Select.Trigger
        {...triggerProps}
        ref={surfaceRef}
        type="button"
        aria-invalid={invalid || undefined}
        className={cn(
          controlClassName({ controlHeight, density, invalid, textAlign, tone }, "selection"),
          "relative block",
          density === "compact" ? "pr-8" : "pr-10",
        )}
        onKeyDown={(event) => {
          if (open || event.nativeEvent.isComposing) return;
          if (
            event.key === "ArrowLeft" ||
            event.key === "ArrowRight" ||
            (event.key === "Enter" && (event.ctrlKey || event.metaKey))
          ) {
            onKeyDown?.(event);
          }
        }}
      >
        <Select.Value className="block truncate">{selectedLabel}</Select.Value>
        <Select.Icon
          className={cn(
            "pointer-events-none absolute top-1/2 -translate-y-1/2 text-[var(--color-text-secondary)]",
            density === "compact" ? "right-2" : "right-3",
          )}
        >
          <ChevronDown aria-hidden="true" className="size-4" />
        </Select.Icon>
      </Select.Trigger>
      {present && !disabled ? (
        <Select.Portal container={container ?? undefined}>
          <Select.Positioner
            alignItemWithTrigger={false}
            side="bottom"
            align="start"
            sideOffset={4}
            collisionPadding={16}
            className="pointer-events-auto z-[var(--z-dropdown)]"
          >
            <Select.Popup className="momo-select-popup rounded-sm border border-[var(--color-border)] bg-[var(--color-surface)] p-1 shadow-[var(--shadow-raised)]">
              {options.map((option) => (
                <SelectOptionRow key={option.value} option={option} />
              ))}
            </Select.Popup>
          </Select.Positioner>
        </Select.Portal>
      ) : null}
    </Select.Root>
  );
}
