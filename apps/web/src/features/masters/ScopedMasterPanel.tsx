import { MasterDeleteDialog, MasterEditDialog } from "@/features/masters/MasterActionDialogs";
import { MasterCreateForm } from "@/features/masters/MasterCreateForm";
import type { MapMasterResponse, SeasonMasterResponse } from "@/shared/api/masters";
import { EmptyState } from "@/shared/ui/feedback/EmptyState";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";

type ScopedMasterItem = (MapMasterResponse | SeasonMasterResponse) & { pending?: boolean };

type MasterCreateBinding = {
  action: (formData: FormData) => void | Promise<void>;
  error?: string | undefined;
  formKey?: string | number | undefined;
};

type ScopedMasterActions = {
  onDelete: (id: string) => Promise<void> | void;
  onUpdate: (id: string, request: { name: string }) => Promise<void>;
};

type ScopedMasterLabels = {
  emptyDescription: string;
  itemLabel: string;
  title: string;
};

type ScopedMasterList = {
  items: ScopedMasterItem[];
  loading?: boolean | undefined;
};

type ScopedMasterPanelProps = {
  actions: ScopedMasterActions;
  create: MasterCreateBinding;
  disabledReason?: string | undefined;
  labels: ScopedMasterLabels;
  list: ScopedMasterList;
  selectedGameTitleName?: string | undefined;
};

const labelClass = "text-xs font-semibold text-[var(--color-text-secondary)]";

export function ScopedMasterPanel({
  actions,
  create,
  disabledReason,
  labels,
  list,
  selectedGameTitleName,
}: ScopedMasterPanelProps) {
  const loading = list.loading ?? false;
  return (
    <section className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <header>
        <p className={labelClass}>{labels.itemLabel}</p>
        <h2 className="mt-1 text-lg font-semibold text-[var(--color-text-primary)]">
          {labels.title}
        </h2>
        <p className="mt-1 line-clamp-2 text-sm text-[var(--color-text-secondary)]">
          {selectedGameTitleName
            ? `選択中の作品: ${selectedGameTitleName}`
            : "作品を選択すると一覧と追加フォームが有効になります。"}
        </p>
      </header>

      {loading ? (
        <div
          aria-busy="true"
          aria-label={`${labels.itemLabel}を読み込み中`}
          className="mt-3 grid gap-2"
        >
          <Skeleton className="h-12 rounded-[var(--radius-sm)]" />
          <Skeleton className="h-12 rounded-[var(--radius-sm)]" />
          <Skeleton className="h-12 rounded-[var(--radius-sm)]" />
        </div>
      ) : list.items.length === 0 ? (
        <EmptyState
          className="mt-3"
          title="登録はまだありません"
          description={labels.emptyDescription}
        />
      ) : (
        <ul className="mt-3 grid gap-2">
          {list.items.map((item) => {
            const isPending = item.pending === true;
            return (
              <li
                key={item.id}
                className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-2 ${
                  isPending ? "opacity-60" : ""
                }`}
                aria-busy={isPending || undefined}
              >
                <div className="min-w-0">
                  <p className="line-clamp-2 text-sm font-semibold text-[var(--color-text-primary)]">
                    {item.name}
                    {isPending ? (
                      <span className="ml-2 text-xs font-normal text-[var(--color-text-secondary)]">
                        (追加中…)
                      </span>
                    ) : null}
                  </p>
                </div>
                {isPending ? null : (
                  <div className="flex items-center">
                    <MasterEditDialog
                      initialName={item.name}
                      label={labels.itemLabel}
                      onSave={async (values) => actions.onUpdate(item.id, { name: values.name })}
                      title={`${labels.itemLabel}を編集`}
                    />
                    <MasterDeleteDialog
                      label={labels.itemLabel}
                      name={item.name}
                      onDelete={() => actions.onDelete(item.id)}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-4">
        <MasterCreateForm
          action={create.action}
          disabled={loading || Boolean(disabledReason)}
          disabledReason={loading ? `${labels.itemLabel}を読み込み中です。` : disabledReason}
          error={create.error}
          formKey={create.formKey}
          label="名称"
          submitLabel="追加"
        />
      </div>
    </section>
  );
}
