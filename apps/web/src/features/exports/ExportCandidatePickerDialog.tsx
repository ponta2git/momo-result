import { Check, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";

import { Button } from "@/shared/ui/actions/Button";
import { IconButton } from "@/shared/ui/actions/IconButton";
import { Dialog } from "@/shared/ui/feedback/Dialog";

import type { ExportScope } from "./exportTypes";
import { candidateDisplayLabel } from "./exportViewModel";
import type { ExportCandidateView } from "./exportViewModel";

type ReadyCandidateView = Extract<ExportCandidateView, { kind: "ready" }>;

type ExportCandidatePickerDialogProps = {
  disabled?: boolean | undefined;
  refreshing?: boolean | undefined;
  scope: Extract<ExportScope, "heldEvent" | "match">;
  view: ReadyCandidateView;
  onChange: (value: string) => void;
  onPageChange: (page: number) => void;
};

function labelForScope(scope: ExportCandidatePickerDialogProps["scope"]): string {
  return scope === "heldEvent" ? "開催" : "試合";
}

function visibleRange(view: ReadyCandidateView): string | undefined {
  const pagination = view.pagination;
  if (!pagination) return undefined;
  if (pagination.totalItems === 0) return "0件 / 全0件";
  const start = (pagination.page - 1) * pagination.pageSize + 1;
  const end = Math.min(pagination.page * pagination.pageSize, pagination.totalItems);
  return `${start.toLocaleString()}-${end.toLocaleString()}件 / 全${pagination.totalItems.toLocaleString()}件`;
}

export function ExportCandidatePickerDialog({
  disabled = false,
  refreshing = false,
  scope,
  view,
  onChange,
  onPageChange,
}: ExportCandidatePickerDialogProps) {
  const [open, setOpen] = useState(false);
  const label = labelForScope(scope);
  const range = visibleRange(view);
  const pagination = view.pagination;

  const selectCandidate = (value: string) => {
    onChange(value);
    setOpen(false);
  };

  return (
    <div className="grid gap-1.5">
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
          surfaceClassName="flex flex-col overflow-y-hidden sm:p-5"
          title={`${label}を選択`}
          trigger={
            <Button
              aria-label={`${label}を変更`}
              className="min-h-11 shrink-0 px-3"
              disabled={disabled}
              icon={<ChevronDown aria-hidden="true" className="size-4" />}
              variant="secondary"
            >
              変更
            </Button>
          }
          onOpenChange={setOpen}
        >
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <fieldset
              aria-label={`${label}候補`}
              className="max-h-[min(24rem,55dvh)] min-h-0 min-w-0 overflow-y-auto overscroll-contain rounded-[var(--radius-sm)] border border-[var(--color-border)]"
            >
              <legend className="sr-only">{label}候補</legend>
              {view.candidates.length === 0 ? (
                <p className="p-3 text-sm text-[var(--color-text-secondary)]">
                  このページに選べる候補はありません。
                </p>
              ) : null}
              {view.candidates.map((candidate) => {
                const selected = candidate.value === view.selectedId;
                return (
                  <label
                    className="momo-pressable grid min-h-11 cursor-pointer grid-cols-[1.25rem_minmax(0,1fr)] items-center gap-2 border-b border-[var(--color-border)] px-3 py-2 last:border-b-0 hover:bg-[var(--color-surface-subtle)] has-[:focus-visible]:outline-3 has-[:focus-visible]:-outline-offset-3 has-[:focus-visible]:outline-[var(--color-action)]"
                    key={candidate.value}
                  >
                    <input
                      aria-label={candidateDisplayLabel(candidate)}
                      checked={selected}
                      className="sr-only"
                      disabled={disabled}
                      name={`export-${scope}-candidate`}
                      type="radio"
                      value={candidate.value}
                      onChange={() => selectCandidate(candidate.value)}
                    />
                    <span
                      aria-hidden="true"
                      className="inline-flex size-5 items-center justify-center rounded-full border border-[var(--color-border-strong)] text-[var(--color-action)]"
                    >
                      {selected ? <Check className="size-3.5" strokeWidth={3} /> : null}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-pretty text-[var(--color-text-primary)]">
                        {candidate.label}
                      </span>
                      {candidate.description ? (
                        <span className="mt-0.5 block text-xs leading-5 text-pretty text-[var(--color-text-secondary)]">
                          {candidate.description}
                        </span>
                      ) : null}
                    </span>
                  </label>
                );
              })}
            </fieldset>

            {pagination && pagination.totalPages > 1 ? (
              <nav
                aria-label={`${label}候補のページネーション`}
                className="flex min-w-0 shrink-0 items-center justify-between gap-3"
              >
                <p className="min-w-0 text-sm font-semibold text-[var(--color-text-secondary)] tabular-nums">
                  {range}
                </p>
                <div className="flex shrink-0 items-center gap-2">
                  <IconButton
                    aria-label="前の候補ページへ"
                    disabled={disabled || !pagination.hasPreviousPage}
                    icon={<ChevronLeft />}
                    size="sm"
                    tooltip="前の候補ページへ"
                    onClick={() => onPageChange(Math.max(1, pagination.page - 1))}
                  />
                  <span className="min-w-14 text-center text-sm font-semibold text-[var(--color-text-secondary)] tabular-nums">
                    {pagination.page.toLocaleString()} / {pagination.totalPages.toLocaleString()}
                  </span>
                  <IconButton
                    aria-label="次の候補ページへ"
                    disabled={disabled || !pagination.hasNextPage}
                    icon={<ChevronRight />}
                    size="sm"
                    tooltip="次の候補ページへ"
                    onClick={() =>
                      onPageChange(Math.min(pagination.totalPages, pagination.page + 1))
                    }
                  />
                </div>
              </nav>
            ) : null}
          </div>
        </Dialog>
      </div>
    </div>
  );
}
