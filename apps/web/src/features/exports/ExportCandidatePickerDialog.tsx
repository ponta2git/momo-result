import { ChoicePickerDialogField } from "@/shared/ui/forms/ChoicePickerDialogField";

import type { ExportScope } from "./exportTypes";
import { candidateDisplayLabel } from "./exportViewModel";
import type { ExportCandidateView } from "./exportViewModel";

type ReadyCandidateView = Extract<ExportCandidateView, { kind: "ready" }>;

type ExportCandidatePickerDialogProps = {
  disabled?: boolean | undefined;
  recovery?: boolean | undefined;
  refreshing?: boolean | undefined;
  scope: Extract<ExportScope, "heldEvent" | "match">;
  view: ReadyCandidateView;
  onChange: (value: string) => void;
  onPageChange: (page: number) => void;
};

function labelForScope(scope: ExportCandidatePickerDialogProps["scope"]): string {
  return scope === "heldEvent" ? "開催" : "試合";
}

export function ExportCandidatePickerDialog({
  disabled = false,
  recovery = false,
  refreshing = false,
  scope,
  view,
  onChange,
  onPageChange,
}: ExportCandidatePickerDialogProps) {
  const label = labelForScope(scope);

  return (
    <ChoicePickerDialogField
      disabled={disabled}
      emptyState="このページに選べる候補はありません。"
      label={label}
      name={`export-${scope}-candidate`}
      options={view.candidates.map((candidate) => ({
        accessibleLabel: candidateDisplayLabel(candidate),
        description: candidate.description,
        label: candidate.label,
        value: candidate.value,
      }))}
      pagination={view.pagination}
      pending={refreshing}
      recovery={recovery}
      selectedLabel={view.selectedLabel}
      value={view.selectedId}
      onPageChange={onPageChange}
      onValueChange={onChange}
    />
  );
}
