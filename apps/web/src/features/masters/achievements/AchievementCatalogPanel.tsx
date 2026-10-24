import { useState } from "react";

import { AchievementCatalogTable } from "@/features/masters/achievements/AchievementCatalogTable";
import { AchievementOrderDialog } from "@/features/masters/achievements/AchievementOrderDialog";
import { useAchievementCatalogPanel } from "@/features/masters/achievements/useAchievementCatalogPanel";
import { achievementRuleOptions } from "@/shared/achievements/achievementPresentation";
import { normalizeUnknownApiError } from "@/shared/api/problemDetails";
import { Button } from "@/shared/ui/actions/Button";
import { Disclosure } from "@/shared/ui/data/Collapsible";
import { AlertDialog, Dialog, DialogFooter } from "@/shared/ui/feedback/Dialog";
import { Notice } from "@/shared/ui/feedback/Notice";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { showToast } from "@/shared/ui/feedback/Toast";
import { CheckboxField } from "@/shared/ui/forms/CheckboxField";
import { TextareaControl } from "@/shared/ui/forms/Control";
import { Field } from "@/shared/ui/forms/Field";
import { SelectField } from "@/shared/ui/forms/SelectField";
import { TextField } from "@/shared/ui/forms/TextField";
import { contentText } from "@/shared/ui/typography";

export function AchievementCatalogPanel({ enabled }: { enabled: boolean }) {
  const {
    gameTitleId,
    setSelection,
    editor,
    setEditor,
    retiring,
    setRetiring,
    discarding,
    setDiscarding,
    validation,
    titles,
    catalog,
    mutation,
    permission,
    conflict,
    dirty,
    items,
    retiredItems,
    save,
    closeEditor,
    updateForm,
    startEditor,
  } = useAchievementCatalogPanel({ enabled });
  const [ordering, setOrdering] = useState(false);
  return (
    <div className="grid min-w-0 gap-6">
      <div className="flex flex-wrap items-end gap-4">
        <SelectField
          label="作品"
          value={gameTitleId ?? ""}
          options={[
            { value: "", label: "作品を選択" },
            ...(titles.data?.items ?? []).map((title) => ({ value: title.id, label: title.name })),
          ]}
          onValueChange={setSelection}
        />
        <Button
          disabled={!permission.allowed || !gameTitleId || !catalog.data}
          onClick={() => startEditor()}
        >
          実績項目を追加
        </Button>
        <Button
          variant="secondary"
          disabled={!permission.allowed || !catalog.data || catalog.isFetching || items.length < 2}
          onClick={() => setOrdering(true)}
        >
          表示順を変更
        </Button>
        <Button
          variant="secondary"
          disabled={!permission.allowed}
          pending={titles.isFetching || catalog.isFetching}
          pendingLabel="更新中"
          onClick={() => {
            void titles.refetch();
            void catalog.refetch();
          }}
        >
          表示を更新
        </Button>
      </div>
      {!permission.allowed && permission.retained ? (
        <Notice tone="info" title="管理権限を確認しています">
          入力は保持しています。確認が終わるまでお待ちください。
        </Notice>
      ) : null}
      {titles.isError || catalog.isError ? (
        <Notice tone="danger" title="実績項目を取得できません">
          取得済みの内容は保持しています。「表示を更新」で再取得してください。
        </Notice>
      ) : null}
      {titles.isLoading || catalog.isLoading ? <Skeleton className="h-48" /> : null}
      {catalog.data ? (
        <AchievementCatalogTable
          items={items}
          maps={catalog.data?.maps ?? []}
          disabled={!permission.allowed || mutation.isPending}
          onEdit={startEditor}
          onRetire={(item) => {
            mutation.reset();
            setRetiring(item);
          }}
        />
      ) : null}
      {retiredItems.length > 0 ? (
        <Disclosure summary={`廃止した項目（${retiredItems.length}件）`} panelSpacing="sm">
          <AchievementCatalogTable
            items={retiredItems}
            maps={catalog.data?.maps ?? []}
            retired
            disabled
            onEdit={startEditor}
            onRetire={setRetiring}
          />
        </Disclosure>
      ) : null}
      {ordering && catalog.data ? (
        <AchievementOrderDialog catalog={catalog.data} onClose={() => setOrdering(false)} />
      ) : null}
      {editor ? (
        <Dialog
          open
          busy={mutation.isPending}
          title={editor.item ? "実績項目を編集" : "実績項目を追加"}
          onOpenChange={(open) => {
            if (!open) closeEditor();
          }}
        >
          <form
            className="grid gap-6"
            onSubmit={(event) => {
              event.preventDefault();
              void save().catch(() => undefined);
            }}
          >
            {conflict ? (
              <Notice tone="warning" title="項目が更新されています">
                入力は保持しています。いったん閉じて最新の項目から編集し直してください。
              </Notice>
            ) : null}
            <fieldset className="grid gap-4" disabled={mutation.isPending || !permission.allowed}>
              <TextField
                label="達成内容"
                required
                value={editor.form.name}
                onChange={(event) => updateForm({ name: event.target.value })}
              />
              <Field label="備考" htmlFor="achievement-item-notes">
                <TextareaControl
                  id="achievement-item-notes"
                  rows={3}
                  value={editor.form.notes}
                  onChange={(event) => updateForm({ notes: event.target.value })}
                />
              </Field>
              <SelectField
                label="難易度"
                value={editor.form.stars}
                options={[1, 2, 3, 4, 5].map((stars) => ({
                  value: String(stars),
                  label: "★".repeat(stars),
                }))}
                onValueChange={(stars) => updateForm({ stars })}
              />
              {!editor.item ? (
                <>
                  <SelectField
                    label="判定方法"
                    value={editor.form.ruleKind}
                    options={[...achievementRuleOptions]}
                    onValueChange={(ruleKind) => updateForm({ ruleKind, threshold: "" })}
                  />
                  {editor.form.ruleKind !== "manual" ? (
                    <TextField
                      label={
                        editor.form.ruleKind === "total_assets"
                          ? "総資産の下限（万円）"
                          : editor.form.ruleKind === "event_average_rank"
                            ? "平均順位の上限"
                            : "回数の下限"
                      }
                      required
                      inputMode={
                        editor.form.ruleKind === "event_average_rank" ? "decimal" : "numeric"
                      }
                      value={editor.form.threshold}
                      onChange={(event) => updateForm({ threshold: event.target.value })}
                      description={
                        editor.form.ruleKind === "total_assets"
                          ? "20億円は200000万円です。"
                          : undefined
                      }
                    />
                  ) : null}
                  <CheckboxField
                    label="作品内の全マップで共通"
                    checked={editor.form.common}
                    onChange={(event) => updateForm({ common: event.target.checked })}
                    description="後から追加するマップにも適用します。"
                  />
                  {!editor.form.common ? (
                    <fieldset className="grid gap-1">
                      <legend className={contentText.body}>対象マップ</legend>
                      {(catalog.data?.maps ?? []).map((map) => (
                        <CheckboxField
                          key={map.mapMasterId}
                          label={map.displayName}
                          checked={editor.form.mapMasterIds.includes(map.mapMasterId)}
                          onChange={(event) =>
                            updateForm({
                              mapMasterIds: event.target.checked
                                ? [...editor.form.mapMasterIds, map.mapMasterId]
                                : editor.form.mapMasterIds.filter((id) => id !== map.mapMasterId),
                            })
                          }
                        />
                      ))}
                    </fieldset>
                  ) : null}
                </>
              ) : (
                <p className={contentText.supporting}>
                  条件・対象マップを変える場合は、新しい項目を追加してください。難易度の変更は達成済みのポイントにも反映されます。
                </p>
              )}
            </fieldset>
            {validation ? <Notice tone="danger">{validation}</Notice> : null}
            {mutation.isError ? (
              <Notice tone="danger" title="項目を保存できませんでした">
                {normalizeUnknownApiError(mutation.error).detail}入力は保持しています。
              </Notice>
            ) : null}
            <DialogFooter>
              <Button variant="secondary" disabled={mutation.isPending} onClick={closeEditor}>
                キャンセル
              </Button>
              <Button
                type="submit"
                pending={mutation.isPending}
                pendingLabel="保存中"
                disabled={!permission.allowed || conflict || !dirty}
              >
                {editor.item ? "変更を保存" : "項目を追加"}
              </Button>
            </DialogFooter>
          </form>
        </Dialog>
      ) : null}
      <AlertDialog
        open={discarding}
        title="未保存の変更を破棄しますか？"
        confirmLabel="破棄して閉じる"
        onOpenChange={setDiscarding}
        onConfirm={() => {
          setEditor(undefined);
          setDiscarding(false);
        }}
      />
      <AlertDialog
        open={Boolean(retiring)}
        title="実績項目を廃止しますか？"
        description={
          retiring?.ruleKind === "manual"
            ? "入力候補と現在のポイントから除き、達成履歴を残します。"
            : "最新の集計が揃っている場合に、達成履歴を固定して現在のポイントから除きます。"
        }
        confirmLabel="廃止する"
        pendingLabel="廃止中"
        confirmDisabled={!permission.allowed}
        formatError={(error) => {
          const problem = normalizeUnknownApiError(error);
          return problem.status === 409
            ? "項目または集計の状態が変わっています。最新の項目と集計を確認してから、廃止し直してください。"
            : problem.detail;
        }}
        onOpenChange={(open) => {
          if (!open) setRetiring(undefined);
        }}
        onConfirm={async () => {
          if (!retiring) return;
          const result = await mutation.mutateAsync({
            kind: "retire",
            gameTitleId: retiring.gameTitleId,
            achievementId: retiring.achievementId,
            expectedVersion: retiring.version,
          });
          if (result.canCommit) {
            setRetiring(undefined);
            showToast({ title: "実績項目を廃止しました", tone: "success" });
          }
        }}
      />
    </div>
  );
}
