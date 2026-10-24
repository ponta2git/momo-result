import { AchievementMatchPicker } from "@/features/achievements/AchievementMatchPicker";
import { useAchievementClaimEditor } from "@/features/achievements/useAchievementClaimEditor";
import type { AchievementClaimEditorProps } from "@/features/achievements/useAchievementClaimEditor";
import { normalizeUnknownApiError } from "@/shared/api/problemDetails";
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
    baseline,
    form,
    setForm,
    confirmation,
    setConfirmation,
    validation,
    identity,
    matchIdentity,
    dirty,
    conflict,
    frozen,
    confirmationRequired,
    eligibleIdentity,
    mutation,
    submit,
    requestClose,
    reload,
  } = useAchievementClaimEditor({ claim, item, onClose });
  return (
    <>
      <UnsavedChangesGuard
        model={{ dirty, isNavigationAllowed: () => false, onDiscard: onClose }}
        pending={mutation.isPending}
        description="実績の訂正はまだ保存されていません。"
      />
      <Dialog
        open
        busy={mutation.isPending}
        title={`${item.name}・${memberDisplayName(claim.memberId)}の記録を訂正`}
        onOpenChange={(open) => {
          if (!open) requestClose();
        }}
      >
        <form
          className="grid gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (form.state === "cancelled" && baseline.claim.state !== "cancelled")
              setConfirmation("cancel");
            else void submit().catch(() => undefined);
          }}
        >
          <p className={contentText.supporting}>
            {claim.sourceKind === "import" ? "移行時の申告" : "直接の手入力"}
            を訂正します。ほかの根拠による達成は維持されます。
          </p>
          {conflict ? (
            <Notice
              tone="warning"
              title="保存済みの記録が更新されています"
              action={
                <Button variant="secondary" size="sm" onClick={() => setConfirmation("reload")}>
                  最新内容を読み込む
                </Button>
              }
            >
              未保存の入力は保持しています。最新の記録を確認して編集し直してください。
            </Notice>
          ) : null}
          {frozen ? (
            <Notice tone="info" title="廃止時点の記録です">
              廃止済みの自動実績は訂正できません。
            </Notice>
          ) : null}
          <fieldset disabled={mutation.isPending || frozen} className="grid gap-4">
            <SelectField
              label="達成の確認"
              value={form.state}
              options={[
                { value: "achieved", label: "達成済み" },
                ...(baseline.claim.state === "unconfirmed"
                  ? [{ value: "unconfirmed", label: "移行元で未確認" }]
                  : []),
                { value: "cancelled", label: "この記録の達成を取り消す" },
              ]}
              onValueChange={(value) => setForm((current) => ({ ...current, state: value }))}
            />
            {confirmationRequired ? (
              <Notice tone="info">
                確認できた結果に応じて「達成済み」または「この記録の達成を取り消す」を選んでから保存してください。
              </Notice>
            ) : null}
            {form.matchId ? (
              <div className="grid gap-1">
                <p className={contentText.body}>
                  {matchIdentity
                    ? `${formatDateTimeLong(matchIdentity.playedAt)}・第${matchIdentity.matchNoInEvent}試合`
                    : identity.data?.kind === "notFound"
                      ? "根拠の試合が見つかりません"
                      : "根拠の試合を確認中"}
                </p>
                <Button
                  variant="quiet"
                  size="sm"
                  onClick={() => setForm((current) => ({ ...current, matchId: "" }))}
                >
                  根拠の紐づけを外す
                </Button>
                {identity.isError ? (
                  <Notice
                    tone="danger"
                    title="根拠の試合を確認できません"
                    action={
                      <Button variant="secondary" size="sm" onClick={() => void identity.refetch()}>
                        再読み込み
                      </Button>
                    }
                  >
                    試合を選び直すか、根拠不明に変更してください。
                  </Notice>
                ) : null}
                {!identity.isLoading && !eligibleIdentity ? (
                  <p className="text-sm text-[var(--color-danger)]">
                    この試合は現在の実績の対象外です。
                  </p>
                ) : null}
              </div>
            ) : (
              <TextField
                label="達成日時（日本時間）"
                type="datetime-local"
                readOnly={Boolean(baseline.claim.matchId)}
                value={form.date}
                onChange={(event) =>
                  setForm((current) => ({ ...current, date: event.target.value }))
                }
                description={
                  baseline.claim.matchId
                    ? "記録していた達成日時を保持します。根拠の紐づけを外して保存した後に、日時を訂正できます。"
                    : "分かる範囲で補完してください。未入力なら日時不明として残します。"
                }
              />
            )}
            <Disclosure
              summary={form.matchId ? "根拠の試合を付け替える" : "根拠の試合を選ぶ"}
              ariaLabel="根拠の確定試合を選ぶ"
              triggerVariant="supporting"
              panelSpacing="sm"
            >
              <AchievementMatchPicker
                item={item}
                selectedId={form.matchId}
                disabled={mutation.isPending}
                onSelect={(matchId) => setForm((current) => ({ ...current, matchId }))}
              />
            </Disclosure>
          </fieldset>
          <p className={cn(contentText.supporting, "tabular-nums")}>
            最終変更：{claim.updatedByDisplayName}・{formatDateTimeLong(claim.updatedAt)}
          </p>
          {validation ? <Notice tone="danger">{validation}</Notice> : null}
          {mutation.isError ? (
            <Notice tone="danger" title="記録を保存できませんでした">
              {normalizeUnknownApiError(mutation.error).detail}入力は保持しています。
            </Notice>
          ) : null}
          <DialogFooter>
            <Button variant="secondary" disabled={mutation.isPending} onClick={requestClose}>
              閉じる
            </Button>
            <Button
              type="submit"
              pending={mutation.isPending}
              pendingLabel="保存中"
              disabled={
                !dirty ||
                conflict ||
                frozen ||
                confirmationRequired ||
                !eligibleIdentity ||
                Boolean(form.matchId && (!matchIdentity || identity.isFetching))
              }
            >
              記録を保存
            </Button>
          </DialogFooter>
        </form>
      </Dialog>
      <AlertDialog
        open={confirmation !== null}
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
          if (!open) setConfirmation(null);
        }}
        onConfirm={async () => {
          if (confirmation === "cancel") await submit();
          else if (confirmation === "reload") {
            reload();
          } else onClose();
          setConfirmation(null);
        }}
      />
    </>
  );
}
