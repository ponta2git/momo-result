import type { HTMLAttributes } from "react";

import type { HeldEventResponse } from "@/shared/api/heldEvents";
import { formatDateTimeLong } from "@/shared/lib/dateTime";
import type { PaginationState } from "@/shared/lib/pagination";
import { ChoicePickerDialogField } from "@/shared/ui/forms/ChoicePickerDialogField";

type HeldEventPickerFieldProps = Omit<
  HTMLAttributes<HTMLDivElement>,
  "children" | "className" | "onChange" | "style"
> & {
  disabled?: boolean | undefined;
  emptyChoiceDescription: string;
  emptyChoiceLabel: string;
  error?: string | undefined;
  heldEvents: HeldEventResponse[];
  label: string;
  name: string;
  pagination?: PaginationState | undefined;
  pending?: boolean | undefined;
  required?: boolean | undefined;
  scopeChanging?: boolean | undefined;
  selectedHeldEvent?: HeldEventResponse | undefined;
  unavailableLabel?: string | undefined;
  value: string;
  onPageChange?: ((page: number) => void) | undefined;
  onValueChange: (value: string, event: HeldEventResponse | undefined) => void;
};

function heldEventDescription(event: HeldEventResponse): string {
  return `確定済み${event.matchCount}試合・未確定下書き${event.draftCount}件`;
}

function heldEventOption(event: HeldEventResponse) {
  const description = heldEventDescription(event);
  const eventLabel = formatDateTimeLong(event.heldAt);
  return {
    accessibleLabel: `${eventLabel} — ${description}`,
    description,
    label: eventLabel,
    value: event.id,
  };
}

/** Adapts held-event DTO paging, copy, and selection semantics to the generic choice field. */
export function HeldEventPickerField({
  disabled,
  emptyChoiceDescription,
  emptyChoiceLabel,
  error,
  heldEvents,
  label,
  name,
  pagination,
  pending,
  required,
  scopeChanging,
  selectedHeldEvent,
  unavailableLabel,
  value,
  onPageChange,
  onValueChange,
  ...fieldProps
}: HeldEventPickerFieldProps) {
  const selected =
    selectedHeldEvent?.id === value
      ? selectedHeldEvent
      : heldEvents.find((event) => event.id === value);
  const selectedLabel = selected
    ? `${formatDateTimeLong(selected.heldAt)} — ${heldEventDescription(selected)}`
    : value
      ? "選択中の開催"
      : heldEvents.length === 0 && unavailableLabel
        ? unavailableLabel
        : emptyChoiceLabel;

  return (
    <ChoicePickerDialogField
      {...fieldProps}
      disabled={disabled}
      emptyState="選べる開催はありません。"
      error={error}
      label={label}
      name={name}
      options={[
        {
          description: emptyChoiceDescription,
          label: emptyChoiceLabel,
          value: "",
        },
        ...(selected && !heldEvents.some((event) => event.id === selected.id)
          ? [heldEventOption(selected)]
          : []),
        ...heldEvents.map(heldEventOption),
      ]}
      pagination={pagination}
      paginationAriaLabel="開催候補のページネーション"
      pending={pending}
      required={required}
      scopeChanging={scopeChanging}
      selectedLabel={selectedLabel}
      value={value}
      onPageChange={onPageChange}
      onValueChange={(nextValue) => {
        onValueChange(
          nextValue,
          selected?.id === nextValue
            ? selected
            : heldEvents.find((event) => event.id === nextValue),
        );
      }}
    />
  );
}
