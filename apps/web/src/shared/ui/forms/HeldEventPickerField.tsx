import type { HTMLAttributes } from "react";

import type { HeldEventResponse } from "@/shared/api/heldEvents";
import { formatDateTimeLong } from "@/shared/lib/dateTime";
import { ChoicePickerDialogField } from "@/shared/ui/forms/ChoicePickerDialogField";

type HeldEventPickerFieldProps = Omit<HTMLAttributes<HTMLDivElement>, "children" | "onChange"> & {
  disabled?: boolean | undefined;
  emptyChoiceDescription: string;
  emptyChoiceLabel: string;
  error?: string | undefined;
  heldEvents: HeldEventResponse[];
  label: string;
  name: string;
  pending?: boolean | undefined;
  required?: boolean | undefined;
  unavailableLabel?: string | undefined;
  value: string;
  onValueChange: (value: string) => void;
};

function heldEventDescription(event: HeldEventResponse): string {
  return `確定 ${event.matchCount}試合・未完了 ${event.draftCount}件`;
}

export function HeldEventPickerField({
  disabled,
  emptyChoiceDescription,
  emptyChoiceLabel,
  error,
  heldEvents,
  label,
  name,
  pending,
  required,
  unavailableLabel,
  value,
  onValueChange,
  ...fieldProps
}: HeldEventPickerFieldProps) {
  const selected = heldEvents.find((event) => event.id === value);
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
        ...heldEvents.map((event) => {
          const description = heldEventDescription(event);
          const eventLabel = formatDateTimeLong(event.heldAt);
          return {
            accessibleLabel: `${eventLabel} — ${description}`,
            description,
            label: eventLabel,
            value: event.id,
          };
        }),
      ]}
      pending={pending}
      required={required}
      selectedLabel={selectedLabel}
      value={value}
      onValueChange={onValueChange}
    />
  );
}
