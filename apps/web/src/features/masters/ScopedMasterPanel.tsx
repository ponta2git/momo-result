import { MasterCreateForm } from "@/features/masters/MasterCreateForm";
import type { MapMasterResponse, SeasonMasterResponse } from "@/shared/api/masters";
import { EmptyState } from "@/shared/ui/feedback/EmptyState";

type ScopedMasterItem = (MapMasterResponse | SeasonMasterResponse) & { pending?: boolean };

type ScopedMasterPanelProps = {
  createAction: (formData: FormData) => void | Promise<void>;
  createError?: string | undefined;
  createFormKey?: string | number | undefined;
  disabledReason?: string | undefined;
  emptyDescription: string;
  itemLabel: string;
  items: ScopedMasterItem[];
  selectedGameTitleName?: string | undefined;
  title: string;
};

const labelClass = "text-xs font-semibold text-[var(--color-text-secondary)]";

export function ScopedMasterPanel({
  createAction,
  createError,
  createFormKey,
  disabledReason,
  emptyDescription,
  itemLabel,
  items,
  selectedGameTitleName,
  title,
}: ScopedMasterPanelProps) {
  return (
    <section className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <header>
        <p className={labelClass}>{itemLabel}</p>
        <h2 className="mt-1 text-lg font-semibold text-[var(--color-text-primary)]">{title}</h2>
        <p className="mt-1 line-clamp-2 text-sm text-[var(--color-text-secondary)]">
          {selectedGameTitleName
            ? `選択中の作品: ${selectedGameTitleName}`
            : "作品を選択すると一覧と追加フォームが有効になります。"}
        </p>
      </header>

      {items.length === 0 ? (
        <EmptyState className="mt-3" title="登録がありません" description={emptyDescription} />
      ) : (
        <ul className="mt-3 grid gap-2">
          {items.map((item) => {
            const isPending = item.pending === true;
            return (
              <li
                key={item.id}
                className={`rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-2 ${
                  isPending ? "opacity-60" : ""
                }`}
                aria-busy={isPending || undefined}
              >
                <p className="line-clamp-2 text-sm font-semibold text-[var(--color-text-primary)]">
                  {item.name}
                  {isPending ? <span className="ml-2 text-xs font-normal text-[var(--color-text-secondary)]">(追加中…)</span> : null}
                </p>
                <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">{item.id}</p>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-4">
        <MasterCreateForm
          action={createAction}
          disabled={Boolean(disabledReason)}
          disabledReason={disabledReason}
          error={createError}
          formKey={createFormKey}
          label="名称"
          submitLabel="追加"
        />
      </div>
    </section>
  );
}
