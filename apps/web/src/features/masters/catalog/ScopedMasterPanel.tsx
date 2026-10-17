import { buildScopedMasterPanelView } from "@/features/masters/catalog/catalogPresentation";
import type { ScopedMasterCatalogView } from "@/features/masters/catalog/catalogTypes";
import {
  MasterDeleteDialog,
  MasterEditDialog,
} from "@/features/masters/catalog/MasterCatalogDialogs";
import { MasterCreateForm } from "@/features/masters/catalog/MasterCreateForm";
import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import { EmptyState } from "@/shared/ui/feedback/EmptyState";
import { Notice } from "@/shared/ui/feedback/Notice";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { contentText } from "@/shared/ui/typography";

export function ScopedMasterPanel({
  actions,
  create,
  disabledReason,
  labels,
  list,
}: ScopedMasterCatalogView & {
  disabledReason?: string | undefined;
  labels: Readonly<{ itemLabel: string; title: string }>;
}) {
  const { loading, loadBlocked, showStaleError, createDisabled, createDisabledReason } =
    buildScopedMasterPanelView(list, labels.itemLabel, disabledReason);
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
    <section className="grid min-w-0 gap-4">
      <header className="flex items-baseline justify-between gap-2">
        <h3 className={contentText.heading}>{labels.title}</h3>
        {!loading && !loadBlocked ? (
          <p className={cn(contentText.supporting, "shrink-0 tabular-nums")}>
            {list.items.length}件
          </p>
        ) : null}
      </header>

      {loading ? (
        <div aria-busy="true" aria-label={`${labels.itemLabel}を読み込み中`} className="grid gap-2">
          <Skeleton className="h-12 rounded-sm" />
          <Skeleton className="h-12 rounded-sm" />
          <Skeleton className="h-12 rounded-sm" />
        </div>
      ) : loadBlocked ? (
        <div>
          <Notice action={retryAction} tone="danger" title={`${labels.itemLabel}を読み込めません`}>
            <p>{list.error}</p>
          </Notice>
        </div>
      ) : (
        <div className="grid gap-4">
          {showStaleError ? (
            <Notice
              action={retryAction}
              tone="warning"
              title={`最新の${labels.itemLabel}を取得できません`}
            >
              <p>直前に取得した内容を表示しています。</p>
            </Notice>
          ) : null}
          {list.items.length === 0 ? (
            <EmptyState placement="embedded" title={`${labels.itemLabel}はまだありません`} />
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
                      <p className={cn(contentText.body, "break-words")}>
                        {item.name}
                        {isPending ? (
                          <span className={cn(contentText.supporting, "ml-2")}>(追加中…)</span>
                        ) : null}
                      </p>
                    </div>
                    {isPending ? null : (
                      <div className="flex items-center gap-2">
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

      <p className={cn(contentText.supporting, "empty:hidden")} role="status">
        {list.completion}
      </p>
      <div>
        <MasterCreateForm
          action={create.action}
          disabled={createDisabled}
          disabledReason={createDisabledReason}
          error={create.error}
          formKey={create.formKey}
          scopeKey={create.scopeKey}
          pending={create.pending}
          label="名称"
          submitLabel="追加"
        />
      </div>
    </section>
  );
}
