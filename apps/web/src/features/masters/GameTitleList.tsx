import { Plus } from "lucide-react";
import { useState } from "react";

import { MasterDeleteDialog, MasterEditDialog } from "@/features/masters/MasterActionDialogs";
import { MasterResourceRefreshNotice } from "@/features/masters/MasterResourceRefreshNotice";
import { layoutFamilies, layoutFamilyLabels } from "@/shared/api/enums";
import type { LayoutFamily } from "@/shared/api/enums";
import type { GameTitleResponse } from "@/shared/api/masters";
import { Button } from "@/shared/ui/actions/Button";
import { Dialog, dialogFooterClassName } from "@/shared/ui/feedback/Dialog";
import { EmptyState } from "@/shared/ui/feedback/EmptyState";
import { ChoiceList } from "@/shared/ui/forms/ChoiceList";
import { SelectField } from "@/shared/ui/forms/SelectField";
import { TextField } from "@/shared/ui/forms/TextField";

type GameTitleListItem = GameTitleResponse & { pending?: boolean };

type MasterCreateBinding = {
  action: (formData: FormData) => void | Promise<void>;
  error?: string | undefined;
  formKey?: string | number | undefined;
  pending?: boolean | undefined;
};

type GameTitleListProps = {
  create: MasterCreateBinding;
  defaultLayoutFamily: LayoutFamily;
  items: GameTitleListItem[];
  onRetry: () => void;
  onDelete: (id: string) => Promise<void> | void;
  onUpdate: (id: string, request: { name: string; layoutFamily: string }) => Promise<void>;
  onSelect: (id: string) => void;
  selectedGameTitleId: string;
  refreshing: boolean;
  stale: boolean;
};

export function GameTitleList({
  create,
  defaultLayoutFamily,
  items,
  onRetry,
  onDelete,
  onUpdate,
  onSelect,
  selectedGameTitleId,
  refreshing,
  stale,
}: GameTitleListProps) {
  const choices = items.map((item) => {
    const isPending = item.pending === true;
    return {
      accessibleLabel: `${item.name}${isPending ? "（追加中）" : ""}`,
      description: `読み取り方式: ${layoutFamilyLabels[item.layoutFamily as LayoutFamily] ?? "未設定"}`,
      label: (
        <>
          {item.name}
          {isPending ? (
            <span className="ml-2 text-xs font-normal text-[var(--color-text-secondary)]">
              (追加中…)
            </span>
          ) : null}
        </>
      ),
      pending: isPending,
      trailingAction: isPending ? undefined : (
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
          <MasterDeleteDialog label="作品" name={item.name} onDelete={() => onDelete(item.id)} />
        </div>
      ),
      value: item.id,
    };
  });

  return (
    <section className="min-w-0">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">作品</h2>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            作品を選ぶと、対応するマップとシーズンを編集できます。
          </p>
        </div>
        <GameTitleCreateDialog
          key={create.formKey}
          create={create}
          defaultLayoutFamily={defaultLayoutFamily}
        />
      </header>

      <MasterResourceRefreshNotice
        className="mt-3"
        onRetry={onRetry}
        resourceLabel="作品"
        retrying={refreshing}
        stale={stale}
      />

      {items.length === 0 ? (
        <EmptyState
          className="mt-3 px-0"
          placement="embedded"
          title="作品はまだありません"
          description="作品を追加すると、マップとシーズンを登録できます。"
        />
      ) : (
        <ChoiceList
          className="mt-3"
          legend="編集する作品"
          name="selected-game-title"
          options={choices}
          value={selectedGameTitleId}
          onValueChange={onSelect}
        />
      )}
    </section>
  );
}

function GameTitleCreateDialog({
  create,
  defaultLayoutFamily,
}: {
  create: MasterCreateBinding;
  defaultLayoutFamily: LayoutFamily;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog
      busy={create.pending}
      description="作品名と、OCRで使う読み取り方式を設定します。"
      open={open}
      title="作品を追加"
      trigger={
        <Button
          className="shrink-0"
          icon={<Plus aria-hidden="true" className="size-4" />}
          size="sm"
          variant="secondary"
        >
          作品を追加
        </Button>
      }
      onOpenChange={setOpen}
    >
      <form action={create.action} className="grid gap-4 py-2">
        <TextField
          error={create.error}
          label="作品名"
          name="name"
          placeholder="例: 桃太郎電鉄2"
          type="text"
        />

        <SelectField
          defaultValue={defaultLayoutFamily}
          description="作品ごとの画面構造に合わせて、読み取り方を切り替えます。"
          label="読み取り方式"
          name="layoutFamily"
          options={layoutFamilies.map((family) => ({
            label: layoutFamilyLabels[family],
            value: family,
          }))}
        />

        <div className={dialogFooterClassName}>
          <Button disabled={create.pending} variant="secondary" onClick={() => setOpen(false)}>
            キャンセル
          </Button>
          <Button pendingLabel="追加中" type="submit">
            追加
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
