import { layoutFamilies } from "@/shared/api/enums";
import type { LayoutFamily } from "@/shared/api/enums";
import type { GameTitleResponse } from "@/shared/api/masters";
import { Button } from "@/shared/ui/actions/Button";
import { EmptyState } from "@/shared/ui/feedback/EmptyState";

const selectClass =
  "w-full min-w-0 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)]";
const labelClass = "text-xs font-semibold text-[var(--color-text-secondary)]";

type GameTitleListProps = {
  createError?: string | undefined;
  createPending?: boolean;
  createValue: {
    layoutFamily: LayoutFamily;
    name: string;
  };
  items: GameTitleResponse[];
  onChangeCreateValue: (patch: Partial<{ layoutFamily: LayoutFamily; name: string }>) => void;
  onCreate: () => void;
  onSelect: (id: string) => void;
  selectedGameTitleId: string;
};

export function GameTitleList({
  createError,
  createPending = false,
  createValue,
  items,
  onChangeCreateValue,
  onCreate,
  onSelect,
  selectedGameTitleId,
}: GameTitleListProps) {
  return (
    <section className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <header>
        <p className={labelClass}>作品</p>
        <h2 className="mt-1 text-lg font-semibold text-[var(--color-text-primary)]">作品マスタ</h2>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          作品を選ぶと、右側のマップ/シーズン表示が同時に切り替わります。
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
            return (
              <li key={item.id}>
                <button
                  className={`w-full rounded-[var(--radius-sm)] border px-3 py-2 text-left transition-colors ${
                    isSelected
                      ? "border-[var(--color-action)]/60 bg-[var(--color-action)]/12"
                      : "border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-subtle)]"
                  }`}
                  type="button"
                  onClick={() => onSelect(item.id)}
                >
                  <p className="line-clamp-2 text-sm font-semibold text-[var(--color-text-primary)]">
                    {item.name}
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
                    {item.layoutFamily}
                  </p>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <form
        className="mt-4 grid gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!createValue.name.trim()) {
            return;
          }
          onCreate();
        }}
      >
        <label className="grid gap-1">
          <span className={labelClass}>作品名</span>
          <input
            className={selectClass}
            placeholder="例: 桃太郎電鉄2"
            value={createValue.name}
            onChange={(event) => onChangeCreateValue({ name: event.target.value })}
          />
        </label>

        <label className="grid gap-1">
          <span className={labelClass}>Layout Family</span>
          <select
            className={selectClass}
            value={createValue.layoutFamily}
            onChange={(event) =>
              onChangeCreateValue({
                layoutFamily: event.target.value as LayoutFamily,
              })
            }
          >
            {layoutFamilies.map((family) => (
              <option key={family} value={family}>
                {family}
              </option>
            ))}
          </select>
          <p className="text-xs text-[var(--color-text-secondary)]">
            OCR profileの選択に使われます。
          </p>
        </label>

        <Button
          type="submit"
          pending={createPending}
          pendingLabel="追加中"
          variant="primary"
          disabled={!createValue.name.trim()}
        >
          作品を追加
        </Button>

        {createError ? (
          <p className="text-sm text-[var(--color-danger)]" role="alert">
            {createError}
          </p>
        ) : null}
      </form>
    </section>
  );
}
