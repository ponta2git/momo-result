import { MasterDeleteDialog, MasterEditDialog } from "@/features/masters/MasterActionDialogs";
import { MasterCreateForm } from "@/features/masters/MasterCreateForm";
import type { MapMasterResponse, SeasonMasterResponse } from "@/shared/api/masters";
import { Button } from "@/shared/ui/actions/Button";
import { EmptyState } from "@/shared/ui/feedback/EmptyState";
import { Notice } from "@/shared/ui/feedback/Notice";
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
  error?: string | undefined;
  hasData: boolean;
  items: ScopedMasterItem[];
  loadFailed: boolean;
  loading?: boolean | undefined;
  onRetry: () => void;
  retrying?: boolean | undefined;
  stale: boolean;
};

type ScopedMasterPanelProps = {
  actions: ScopedMasterActions;
  create: MasterCreateBinding;
  disabledReason?: string | undefined;
  labels: ScopedMasterLabels;
  list: ScopedMasterList;
};

export function ScopedMasterPanel({
  actions,
  create,
  disabledReason,
  labels,
  list,
}: ScopedMasterPanelProps) {
  const loading = list.loading ?? false;
  const loadBlocked = list.loadFailed && !list.hasData;
  const showStaleError = list.stale && list.hasData && Boolean(list.error);
  const retryAction = (
    <Button
      pending={Boolean(list.retrying)}
      pendingLabel="再読み込み中"
      size="sm"
      variant={loadBlocked ? "primary" : "secondary"}
      onClick={list.onRetry}
    >
      {labels.itemLabel}を再読み込み
    </Button>
  );
  return (
    <section className="min-w-0">
      <header className="flex items-baseline justify-between gap-3">
        <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">{labels.title}</h3>
        {!loading && !loadBlocked ? (
          <p className="shrink-0 text-xs text-[var(--color-text-secondary)] tabular-nums">
            {list.items.length}件
          </p>
        ) : null}
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
      ) : loadBlocked ? (
        <Notice className="mt-3" tone="danger" title={`${labels.itemLabel}を読み込めません`}>
          <p>{list.error}</p>
          <div className="mt-3">{retryAction}</div>
        </Notice>
      ) : (
        <div className="mt-3 grid gap-3">
          {showStaleError ? (
            <Notice tone="warning" title={`最新の${labels.itemLabel}を取得できません`}>
              <p>直前に取得した内容を表示しています。</p>
              <div className="mt-3">{retryAction}</div>
            </Notice>
          ) : null}
          {list.items.length === 0 ? (
            <EmptyState
              className="px-0"
              description={labels.emptyDescription}
              placement="embedded"
              title="登録はまだありません"
            />
          ) : (
            <ul className="divide-y divide-[var(--color-border)]">
              {list.items.map((item) => {
                const isPending = item.pending === true;
                return (
                  <li
                    key={item.id}
                    className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 py-2 ${
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
                          onSave={async (values) =>
                            actions.onUpdate(item.id, { name: values.name })
                          }
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
        </div>
      )}

      <div className="mt-4">
        <MasterCreateForm
          action={create.action}
          disabled={loading || loadBlocked || Boolean(disabledReason)}
          disabledReason={
            loading
              ? `${labels.itemLabel}を読み込み中です。`
              : loadBlocked
                ? `${labels.itemLabel}を読み込んでから追加できます。`
                : disabledReason
          }
          error={create.error}
          formKey={create.formKey}
          label="名称"
          submitLabel="追加"
        />
      </div>
    </section>
  );
}
