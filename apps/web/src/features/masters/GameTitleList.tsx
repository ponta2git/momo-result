import { useFormStatus } from "react-dom";

import { MasterDeleteDialog, MasterEditDialog } from "@/features/masters/MasterActionDialogs";
import { layoutFamilies, layoutFamilyLabels } from "@/shared/api/enums";
import type { LayoutFamily } from "@/shared/api/enums";
import type { GameTitleResponse } from "@/shared/api/masters";
import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import { EmptyState } from "@/shared/ui/feedback/EmptyState";

const selectClass =
  "w-full min-w-0 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)]";
const labelClass = "text-xs font-semibold text-[var(--color-text-secondary)]";

type GameTitleListItem = GameTitleResponse & { pending?: boolean };

type GameTitleListProps = {
  createAction: (formData: FormData) => void | Promise<void>;
  createError?: string | undefined;
  createFormKey?: string | number | undefined;
  defaultLayoutFamily: LayoutFamily;
  items: GameTitleListItem[];
  onDelete: (id: string) => Promise<void> | void;
  onUpdate: (id: string, request: { name: string; layoutFamily: string }) => Promise<void>;
  onSelect: (id: string) => void;
  selectedGameTitleId: string;
};

function CreateButton() {
  const { pending } = useFormStatus();
  return (
    <Button
      disabled={pending}
      pending={pending}
      pendingLabel="追加中"
      type="submit"
      variant="primary"
    >
      作品を追加
    </Button>
  );
}

export function GameTitleList({
  createAction,
  createError,
  createFormKey,
  defaultLayoutFamily,
  items,
  onDelete,
  onUpdate,
  onSelect,
  selectedGameTitleId,
}: GameTitleListProps) {
  return (
    <section className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <header>
        <p className={labelClass}>作品</p>
        <h2 className="mt-1 text-lg font-semibold text-[var(--color-text-primary)]">作品</h2>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          作品を選ぶと、対応するマップとシーズンが表示されます。
        </p>
      </header>

      {items.length === 0 ? (
        <EmptyState
          className="mt-3"
          title="作品がまだありません"
          description="まず作品を1件追加してください。"
        />
      ) : (
        <ul className="mt-3 grid gap-2">
          {items.map((item) => {
            const isSelected = item.id === selectedGameTitleId;
            const isPending = item.pending === true;
            return (
              <li key={item.id}>
                <div
                  className={cn(
                    "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-[var(--radius-sm)] border px-3 py-2 transition-colors",
                    isSelected
                      ? "border-[var(--color-action)]/60 bg-[var(--color-action)]/12"
                      : "border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-subtle)]",
                    isPending ? "opacity-60" : "",
                  )}
                  aria-busy={isPending || undefined}
                >
                  <button
                    className="min-w-0 text-left"
                    type="button"
                    disabled={isPending}
                    onClick={() => onSelect(item.id)}
                  >
                    <p className="line-clamp-2 text-sm font-semibold text-[var(--color-text-primary)]">
                      {item.name}
                      {isPending ? (
                        <span className="ml-2 text-xs font-normal text-[var(--color-text-secondary)]">
                          (追加中…)
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
                      読み取り方式:{" "}
                      {layoutFamilyLabels[item.layoutFamily as LayoutFamily] ?? "未設定"}
                    </p>
                  </button>
                  {isPending ? null : (
                    <div className="flex items-center">
                      <MasterEditDialog
                        initialLayoutFamily={item.layoutFamily}
                        initialName={item.name}
                        label="作品"
                        onSave={async (values) => {
                          await onUpdate(item.id, {
                            name: values.name,
                            layoutFamily: values.layoutFamily ?? item.layoutFamily,
                          });
                        }}
                        showLayoutFamily
                        title="作品を編集"
                      />
                      <MasterDeleteDialog
                        label="作品"
                        name={item.name}
                        onDelete={() => onDelete(item.id)}
                      />
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <form action={createAction} className="mt-4 grid gap-2" key={createFormKey}>
        <label className="grid gap-1">
          <span className={labelClass}>作品名</span>
          <input className={selectClass} name="name" placeholder="例: 桃太郎電鉄2" type="text" />
        </label>

        <label className="grid gap-1">
          <span className={labelClass}>読み取り方式</span>
          <select className={selectClass} defaultValue={defaultLayoutFamily} name="layoutFamily">
            {layoutFamilies.map((family) => (
              <option key={family} value={family}>
                {layoutFamilyLabels[family]}
              </option>
            ))}
          </select>
          <p className="text-xs text-[var(--color-text-secondary)]">
            作品ごとの画面構造に合わせて、読み取り方を切り替えます。
          </p>
        </label>

        <CreateButton />

        {createError ? (
          <p className="text-sm text-[var(--color-danger)]" role="alert">
            {createError}
          </p>
        ) : null}
      </form>
    </section>
  );
}
