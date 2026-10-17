import { Plus } from "lucide-react";
import { startTransition, useState } from "react";

import { buildGameTitleChoices } from "@/features/masters/catalog/catalogPresentation";
import type {
  GameTitleCatalogView,
  MasterCreateFormView,
} from "@/features/masters/catalog/catalogTypes";
import {
  MasterDeleteDialog,
  MasterEditDialog,
} from "@/features/masters/catalog/MasterCatalogDialogs";
import { MasterResourceRefreshNotice } from "@/features/masters/MasterResourceRefreshNotice";
import { layoutFamilies, layoutFamilyLabels } from "@/shared/domain/ocr";
import type { LayoutFamily } from "@/shared/domain/ocr";
import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import { Dialog, DialogFooter } from "@/shared/ui/feedback/Dialog";
import { EmptyState } from "@/shared/ui/feedback/EmptyState";
import { ChoiceList } from "@/shared/ui/forms/ChoiceList";
import { SelectField } from "@/shared/ui/forms/SelectField";
import { TextField } from "@/shared/ui/forms/TextField";
import { ContentWithActions } from "@/shared/ui/layout/ContentWithActions";
import { contentText } from "@/shared/ui/typography";

export function GameTitleList({
  canEdit,
  completion,
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
}: GameTitleCatalogView) {
  const choices = buildGameTitleChoices(items, canEdit).map((choice) => {
    const { item, pending: isPending } = choice;
    return {
      accessibleLabel: choice.accessibleLabel,
      description: choice.description,
      label: (
        <>
          {item.name}
          {isPending ? <span className={cn(contentText.supporting, "ml-2")}>(追加中…)</span> : null}
        </>
      ),
      disabled: isPending,
      trailingAction: choice.editable ? (
        <div className="flex items-center gap-2">
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
      ) : undefined,
      value: item.id,
    };
  });

  return (
    <section className="grid min-w-0 gap-4">
      <ContentWithActions
        actions={
          canEdit ? (
            <GameTitleCreateDialog
              key={create.formKey}
              create={create}
              defaultLayoutFamily={defaultLayoutFamily}
            />
          ) : undefined
        }
      >
        <div>
          <h2 className={contentText.heading}>作品</h2>
          <p className={cn(contentText.body, "mt-1")}>
            作品を選ぶと、対応するマップとシーズンを編集できます。
          </p>
        </div>
      </ContentWithActions>

      <p className={cn(contentText.supporting, "empty:hidden")} role="status">
        {completion}
      </p>
      <div className="empty:hidden">
        <MasterResourceRefreshNotice
          onRetry={onRetry}
          resourceLabel="作品"
          retrying={refreshing}
          stale={stale}
        />
      </div>

      {items.length === 0 ? (
        <div>
          <EmptyState
            placement="embedded"
            title="作品はまだありません"
            description={
              canEdit
                ? "作品を追加すると、マップとシーズンを登録できます。"
                : "マップとシーズンを登録するには、管理者による作品の登録が必要です。"
            }
          />
        </div>
      ) : (
        <div>
          <ChoiceList
            legend="編集する作品"
            name="selected-game-title"
            options={choices}
            value={selectedGameTitleId}
            onValueChange={onSelect}
          />
        </div>
      )}
    </section>
  );
}

function GameTitleCreateDialog({
  create,
  defaultLayoutFamily,
}: {
  create: MasterCreateFormView;
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
        <Button icon={<Plus aria-hidden="true" />} size="sm" variant="secondary">
          作品を追加
        </Button>
      }
      onOpenChange={setOpen}
    >
      <form
        className="grid gap-6"
        onSubmit={(event) => {
          event.preventDefault();
          if (create.pending) return;
          const data = new FormData(event.currentTarget);
          startTransition(() => create.action(data));
        }}
      >
        <div className="grid gap-4">
          <TextField
            disabled={create.pending}
            error={create.error}
            label="作品名"
            name="name"
            placeholder="例: 桃太郎電鉄2"
            type="text"
          />
          <SelectField
            disabled={create.pending}
            defaultValue={defaultLayoutFamily}
            description="作品ごとの画面構造に合わせて、読み取り方を切り替えます。"
            label="読み取り方式"
            name="layoutFamily"
            options={layoutFamilies.map((family) => ({
              label: layoutFamilyLabels[family],
              value: family,
            }))}
          />
        </div>

        <DialogFooter>
          <Button disabled={create.pending} variant="secondary" onClick={() => setOpen(false)}>
            キャンセル
          </Button>
          <Button pending={create.pending ?? false} pendingLabel="追加中" type="submit">
            追加
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
