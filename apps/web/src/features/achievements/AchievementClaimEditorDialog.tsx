import { AchievementMatchPicker } from "@/features/achievements/AchievementMatchPicker";
import { useAchievementClaimEditor } from "@/features/achievements/useAchievementClaimEditor";
import type { AchievementClaimEditorProps } from "@/features/achievements/useAchievementClaimEditor";
import { memberDisplayName } from "@/shared/domain/members";
import { formatDateTimeLong } from "@/shared/lib/dateTime";
import { UnsavedChangesGuard } from "@/shared/navigation/UnsavedChangesGuard";
import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import { Disclosure } from "@/shared/ui/data/Collapsible";
import { AlertDialog, Dialog, DialogFooter } from "@/shared/ui/feedback/Dialog";
import { Notice } from "@/shared/ui/feedback/Notice";
import { SelectField } from "@/shared/ui/forms/SelectField";
import { TextField } from "@/shared/ui/forms/TextField";
import { contentText } from "@/shared/ui/typography";

export function AchievementClaimEditorDialog({
  claim,
  item,
  onClose,
}: AchievementClaimEditorProps) {
  const {
    form,
    changeState,
    selectMatch,
    changeDate,
    canLeaveUnconfirmed,
    dateLocked,
    confirmation,
    dismissConfirmation,
    confirmAction,
    requestReload,
    validation,
    matchIdentity,
    matchMissing,
    matchLoading,
    matchFailed,
    retryMatch,
    dirty,
    conflict,
    automatic,
    confirmationRequired,
    eligibleIdentity,
    saving,
    saveError,
    canSave,
    requestSave,
    requestClose,
  } = useAchievementClaimEditor({ claim, item, onClose });
  return (
    <>
      <UnsavedChangesGuard
        model={{ dirty, isNavigationAllowed: () => false, onDiscard: onClose }}
        pending={saving}
        description="実績の訂正はまだ保存されていません。"
      />
      <Dialog
        open
        busy={saving}
        title={`${item.name}・${memberDisplayName(claim.memberId)}の記録を訂正`}
        onOpenChange={(open) => {
          if (!open) requestClose();
        }}
      >
        <form
          className="grid gap-6"
          onSubmit={(event) => {
            event.preventDefault();
            void requestSave().catch(() => undefined);
          }}
        >
          {!automatic && claim.sourceKind === "import" ? (
            <p className={contentText.body}>
              以前の実績リストから引き継いだ記録です。達成の有無を直したり、分かった日時や試合を追加したりできます。
            </p>
          ) : null}
          {conflict ? (
            <Notice
              tone="warning"
              title="保存済みの記録が更新されています"
              action={
                <Button variant="secondary" size="sm" onClick={requestReload}>
                  最新内容を読み込む
                </Button>
              }
            >
              未保存の入力は保持しています。最新の記録を確認して編集し直してください。
            </Notice>
          ) : null}
          {automatic ? (
            <Notice
              tone="info"
              title={item.retiredAt ? "廃止時点の記録です" : "試合結果から自動で判定する実績です"}
            >
              {item.retiredAt
                ? "廃止済みの自動実績は訂正できません。"
                : "達成状況を直す場合は、元の試合結果を訂正してください。"}
            </Notice>
          ) : null}
          <fieldset disabled={saving || automatic} className="grid gap-4">
            <SelectField
              label="達成の確認"
              value={form.state}
              options={[
                { value: "achieved", label: "達成した" },
                ...(canLeaveUnconfirmed ? [{ value: "unconfirmed", label: "確認待ち" }] : []),
                { value: "cancelled", label: "この記録の達成を取り消す" },
              ]}
              onValueChange={changeState}
            />
            {confirmationRequired ? (
              <Notice tone="info">
                確認できたら「達成した」または「この記録の達成を取り消す」を選んで保存できます。
              </Notice>
            ) : null}
            {form.matchId ? (
              <div className="grid gap-1">
                <p className={contentText.body}>
                  {matchIdentity
                    ? `${formatDateTimeLong(matchIdentity.playedAt)}・第${matchIdentity.matchNoInEvent}試合`
                    : matchMissing
                      ? "達成した試合が見つかりません"
                      : "達成した試合を読み込み中"}
                </p>
                <Button variant="quiet" size="sm" onClick={() => selectMatch("")}>
                  試合の指定を外す
                </Button>
                {matchFailed ? (
                  <Notice
                    tone="danger"
                    title="達成した試合を読み込めません"
                    action={
                      <Button variant="secondary" size="sm" onClick={retryMatch}>
                        再読み込み
                      </Button>
                    }
                  >
                    再読み込みするか、試合の指定を外してください。
                  </Notice>
                ) : null}
                {!matchLoading && !eligibleIdentity ? (
                  <p className="text-sm text-[var(--color-danger)]">
                    この試合は現在の実績の対象外です。
                  </p>
                ) : null}
              </div>
            ) : (
              <TextField
                label="達成日時（日本時間）"
                type="datetime-local"
                readOnly={dateLocked}
                value={form.date}
                onChange={(event) => changeDate(event.currentTarget.value)}
                description={
                  dateLocked
                    ? "日時は今のまま残ります。試合の指定を外して保存すると、日時も変更できます。"
                    : "分かる日時を入力してください。分からない場合は空欄のまま保存できます。"
                }
              />
            )}
            <Disclosure
              summary={form.matchId ? "達成した試合を変更する" : "達成した試合を選ぶ"}
              ariaLabel={form.matchId ? "達成した試合を変更する" : "達成した試合を選ぶ"}
              triggerVariant="supporting"
              panelSpacing="sm"
            >
              <AchievementMatchPicker
                item={item}
                selectedId={form.matchId}
                disabled={saving}
                onSelect={selectMatch}
              />
            </Disclosure>
          </fieldset>
          <p className={cn(contentText.supporting, "tabular-nums")}>
            最終変更：{claim.updatedByDisplayName}・{formatDateTimeLong(claim.updatedAt)}
          </p>
          {validation ? <Notice tone="danger">{validation}</Notice> : null}
          {saveError ? (
            <Notice tone="danger" title="記録を保存できませんでした">
              {saveError}入力は保持しています。
            </Notice>
          ) : null}
          <DialogFooter>
            <Button variant="secondary" disabled={saving} onClick={requestClose}>
              キャンセル
            </Button>
            <Button type="submit" pending={saving} pendingLabel="保存中" disabled={!canSave}>
              記録を保存
            </Button>
          </DialogFooter>
        </form>
      </Dialog>
      <AlertDialog
        open={confirmation !== null}
        description={
          confirmation === "cancel"
            ? "別の試合や以前の記録でも達成している場合、その達成は残ります。"
            : undefined
        }
        title={
          confirmation === "cancel"
            ? "この記録の達成を取り消しますか？"
            : confirmation === "reload"
              ? "未保存の入力を破棄して最新内容を読み込みますか？"
              : "未保存の訂正を破棄しますか？"
        }
        confirmLabel={
          confirmation === "cancel"
            ? "この記録を取り消す"
            : confirmation === "reload"
              ? "破棄して読み込む"
              : "破棄して閉じる"
        }
        onOpenChange={(open) => {
          if (!open) dismissConfirmation();
        }}
        onConfirm={confirmAction}
      />
    </>
  );
}
