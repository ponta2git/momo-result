import { AchievementMatchPicker } from "@/features/achievements/AchievementMatchPicker";
import { useAchievementRecord } from "@/features/achievements/useAchievementRecord";
import type { AchievementRecordProps } from "@/features/achievements/useAchievementRecord";
import { normalizeUnknownApiError } from "@/shared/api/problemDetails";
import { memberDisplayName } from "@/shared/domain/members";
import { formatDateTimeLong } from "@/shared/lib/dateTime";
import { UnsavedChangesGuard } from "@/shared/navigation/UnsavedChangesGuard";
import { Button } from "@/shared/ui/actions/Button";
import { Disclosure } from "@/shared/ui/data/Collapsible";
import { AlertDialog, Dialog, DialogFooter } from "@/shared/ui/feedback/Dialog";
import { Notice } from "@/shared/ui/feedback/Notice";
import { contentText } from "@/shared/ui/typography";

export function AchievementRecordDialog(props: AchievementRecordProps) {
  const { item, memberId, onClose } = props;
  const {
    matchId,
    setMatchId,
    confirmClose,
    setConfirmClose,
    refreshing,
    reloadFailed,
    identity,
    matchIdentity,
    eligible,
    unavailable,
    mutation,
    conflict,
    canSave,
    submit,
    reload,
    requestClose,
  } = useAchievementRecord(props);
  const busy = mutation.isPending || refreshing;
  const picker = (
    <AchievementMatchPicker
      item={item}
      selectedId={matchId}
      disabled={busy || unavailable}
      onSelect={setMatchId}
    />
  );
  return (
    <>
      <UnsavedChangesGuard
        model={{ dirty: Boolean(matchId), isNavigationAllowed: () => false, onDiscard: onClose }}
        pending={busy}
        description="選んだ試合での達成はまだ保存されていません。"
      />
      <Dialog
        open
        busy={busy}
        title={`${item.name}・${memberDisplayName(memberId)}の達成を記録`}
        onOpenChange={(open) => {
          if (!open) requestClose();
        }}
      >
        <form
          className="grid gap-6"
          onSubmit={(event) => {
            event.preventDefault();
            void submit().catch(() => undefined);
          }}
        >
          <p className={contentText.body}>
            達成した試合を選んでください。達成日時には、その試合の日時を使います。
          </p>
          {unavailable ? (
            <Notice
              tone="warning"
              title={
                props.existingClaim
                  ? "この実績はすでに記録されています"
                  : "この実績は追加できません"
              }
            >
              閉じて現在の実績の記録を確認してください。
            </Notice>
          ) : conflict ? (
            <Notice
              tone="warning"
              title="実績または試合が更新されています"
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  pending={refreshing}
                  onClick={() => void reload()}
                >
                  最新内容を読み込む
                </Button>
              }
            >
              試合の選択は保持しています。最新内容を確認して、もう一度保存してください。
            </Notice>
          ) : null}
          {reloadFailed ? (
            <Notice tone="danger">最新内容を読み込めませんでした。再試行してください。</Notice>
          ) : null}
          {matchId ? (
            <div className="grid gap-2" aria-label="選択した試合">
              <p className={contentText.primary}>
                {matchIdentity
                  ? `${formatDateTimeLong(matchIdentity.playedAt)}・第${matchIdentity.matchNoInEvent}試合`
                  : identity.data?.kind === "notFound"
                    ? "選んだ試合が見つかりません"
                    : "選んだ試合を確認中"}
              </p>
              {identity.isError ? (
                <Notice
                  tone="danger"
                  title="試合を確認できません"
                  action={
                    <Button variant="secondary" size="sm" onClick={() => void identity.refetch()}>
                      再読み込み
                    </Button>
                  }
                >
                  通信状態を確認して再試行してください。
                </Notice>
              ) : !identity.isFetching && !eligible ? (
                <Notice tone="warning">
                  この試合は実績の対象外です。別の試合を選んでください。
                </Notice>
              ) : null}
            </div>
          ) : null}
          {matchId ? (
            <Disclosure
              summary="達成した試合を変更する"
              triggerVariant="supporting"
              panelSpacing="sm"
            >
              {picker}
            </Disclosure>
          ) : (
            picker
          )}
          {mutation.isError && !conflict ? (
            <Notice tone="danger" title="達成を保存できませんでした">
              {normalizeUnknownApiError(mutation.error).detail}試合の選択は保持しています。
            </Notice>
          ) : null}
          <DialogFooter>
            <Button variant="secondary" disabled={busy} onClick={requestClose}>
              キャンセル
            </Button>
            <Button
              type="submit"
              pending={mutation.isPending}
              pendingLabel="保存中"
              disabled={!canSave}
            >
              達成を保存
            </Button>
          </DialogFooter>
        </form>
      </Dialog>
      <AlertDialog
        open={confirmClose}
        title="未保存の達成を破棄しますか？"
        confirmLabel="破棄して閉じる"
        onOpenChange={setConfirmClose}
        onConfirm={onClose}
      />
    </>
  );
}
