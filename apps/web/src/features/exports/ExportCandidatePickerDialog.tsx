import { ChevronDown } from "lucide-react";
import { useState } from "react";

import { Button } from "@/shared/ui/actions/Button";
import { PaginationControls } from "@/shared/ui/data/PaginationControls";
import { Dialog } from "@/shared/ui/feedback/Dialog";
import { ChoiceList } from "@/shared/ui/forms/ChoiceList";

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
  const [open, setOpen] = useState(false);
  const label = labelForScope(scope);
  const pagination = view.pagination;

  const selectCandidate = (value: string) => {
    onChange(value);
    setOpen(false);
  };

  return (
    <div className="grid gap-2">
      <p className="text-sm leading-5 font-semibold text-[var(--color-text-primary)]">{label}</p>
      <div className="flex min-h-11 min-w-0 items-center gap-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] p-2 pl-3">
        <p className="min-w-0 flex-1 text-sm leading-5 font-medium text-pretty text-[var(--color-text-primary)]">
          {view.selectedLabel}
        </p>
        <Dialog
          busy={refreshing}
          className="flex min-h-0 flex-col"
          open={open}
          popupClassName="overflow-y-hidden"
          surfaceClassName="flex flex-col overflow-y-hidden"
          title={`${label}を選択`}
          trigger={
            <Button
              aria-label={`${label}を${recovery ? "選び直す" : "変更"}`}
              className="min-h-11 shrink-0 px-3"
              disabled={disabled}
              icon={<ChevronDown aria-hidden="true" className="size-4" />}
              variant={recovery ? "primary" : "secondary"}
            >
              {recovery ? "選び直す" : "変更"}
            </Button>
          }
          onOpenChange={setOpen}
        >
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <ChoiceList
              className="flex min-h-0 flex-col"
              disabled={disabled}
              emptyState="このページに選べる候補はありません。"
              legend={`${label}候補`}
              listClassName="max-h-[min(24rem,55dvh)] min-h-0 flex-1 overflow-y-auto overscroll-contain"
              name={`export-${scope}-candidate`}
              options={view.candidates.map((candidate) => ({
                accessibleLabel: candidateDisplayLabel(candidate),
                description: candidate.description,
                label: candidate.label,
                value: candidate.value,
              }))}
              pending={refreshing}
              value={view.selectedId}
              onValueChange={selectCandidate}
            />

            {pagination && pagination.totalPages > 1 ? (
              <PaginationControls
                ariaLabel={`${label}候補のページネーション`}
                className="shrink-0 p-0"
                disabled={disabled || refreshing}
                pagination={pagination}
                placement="embedded"
                variant="compact"
                onPageChange={onPageChange}
              />
            ) : null}
          </div>
        </Dialog>
      </div>
    </div>
  );
}
