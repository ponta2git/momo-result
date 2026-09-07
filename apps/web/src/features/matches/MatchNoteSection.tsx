import { useMatchNoteEditor } from "@/features/matches/useMatchNoteEditor";
import { MatchWorkspaceNavigationGuard } from "@/features/matches/workspace/MatchWorkspaceNavigationGuard";
import { matchNoteMaximumCharacters } from "@/features/matches/workspace/review/confirmMatchFormSchema";
import type { MatchDetailResponse } from "@/shared/api/matches";
import { formatDateTimeLong } from "@/shared/lib/dateTime";
import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import { AlertDialog } from "@/shared/ui/feedback/Dialog";
import { Notice } from "@/shared/ui/feedback/Notice";
import { TextareaControl } from "@/shared/ui/forms/Control";
import { ContentWithActions } from "@/shared/ui/layout/ContentWithActions";
import { readableTextWidthClass } from "@/shared/ui/layout/readableText";
import { contentText, fieldText } from "@/shared/ui/typography";

type MatchNoteSectionProps = {
  match: MatchDetailResponse;
  refetchMatch: () => Promise<{ data?: MatchDetailResponse | undefined }>;
};

export function MatchNoteSection({ match, refetchMatch }: MatchNoteSectionProps) {
  const editor = useMatchNoteEditor({ match, refetchMatch });
  const {
    cancel,
    conflict,
    count,
    deleteOpen,
    dirty,
    draft,
    editing,
    errorMessage,
    navigationAllowedRef,
    normalizedDraft,
    pending,
    remove,
    save,
    setDeleteOpen,
    setDraft,
    startEditing,
    tooLong,
  } = editor;

  return (
    <section aria-labelledby="match-note-heading" className="grid gap-4">
      <MatchWorkspaceNavigationGuard model={{ dirty, navigationAllowedRef, onDiscard: cancel }} />
      <ContentWithActions
        actions={
          editing ? null : (
            <div
              aria-label="試合メモの操作"
              className="flex shrink-0 flex-wrap items-center gap-2"
              role="group"
            >
              <Button size="sm" variant="secondary" onClick={startEditing}>
                {match.note.body ? "編集" : "メモを追加"}
              </Button>
              {match.note.body ? (
                <Button size="sm" variant="dangerQuiet" onClick={() => setDeleteOpen(true)}>
                  メモを削除
                </Button>
              ) : null}
            </div>
          )
        }
      >
        <div className="grid min-w-0 gap-2">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className={contentText.heading} id="match-note-heading">
              試合メモ
            </h2>
            {editing ? (
              <span
                aria-live="polite"
                className={cn(tooLong ? fieldText.error : contentText.supporting, "tabular-nums")}
              >
                {count} / {matchNoteMaximumCharacters}
              </span>
            ) : null}
          </div>

          {editing ? (
            <div className="grid gap-4">
              <div className="grid gap-1">
                <TextareaControl
                  aria-label="試合メモ"
                  aria-describedby={tooLong ? "match-note-detail-error" : undefined}
                  disabled={pending}
                  invalid={tooLong}
                  minHeight="md"
                  resize="vertical"
                  textFlow="relaxed"
                  value={draft}
                  onChange={(event) => setDraft(event.currentTarget.value)}
                />
                {tooLong ? (
                  <p className={fieldText.error} id="match-note-detail-error" role="alert">
                    試合メモは{matchNoteMaximumCharacters}字以内で入力してください。
                  </p>
                ) : null}
              </div>
              {conflict ? (
                <Notice tone="warning" title="別の利用者が先に更新しました">
                  <div className="grid gap-4">
                    <div>
                      <p className={contentText.heading}>保存済みの最新版</p>
                      <p
                        className={cn(
                          contentText.body,
                          "mt-1 break-words whitespace-pre-wrap",
                          readableTextWidthClass,
                        )}
                      >
                        {conflict.latest.body ?? "（メモなし）"}
                      </p>
                    </div>
                    <div>
                      <p className={contentText.heading}>あなたの入力</p>
                      <p
                        className={cn(
                          contentText.body,
                          "mt-1 break-words whitespace-pre-wrap",
                          readableTextWidthClass,
                        )}
                      >
                        {conflict.draft}
                      </p>
                    </div>
                  </div>
                </Notice>
              ) : null}
              <div className="flex flex-wrap justify-end gap-2">
                <Button disabled={pending} variant="quiet" onClick={cancel}>
                  キャンセル
                </Button>
                <Button
                  disabled={
                    pending ||
                    tooLong ||
                    normalizedDraft.trim().length === 0 ||
                    (!dirty && !conflict)
                  }
                  pending={pending}
                  pendingLabel="保存中…"
                  onClick={save}
                >
                  {conflict ? "この入力で再試行" : "保存"}
                </Button>
              </div>
            </div>
          ) : match.note.body ? (
            <div className="grid gap-1">
              <p
                className={cn(
                  contentText.body,
                  "break-words whitespace-pre-wrap",
                  readableTextWidthClass,
                )}
              >
                {match.note.body}
              </p>
              {match.note.updatedAt ? (
                <p className={contentText.supporting}>
                  {match.note.updatedByDisplayName ?? "利用者"}が
                  {formatDateTimeLong(match.note.updatedAt)}に更新
                </p>
              ) : null}
            </div>
          ) : (
            <p className={contentText.body}>まだメモはありません。</p>
          )}
        </div>
      </ContentWithActions>

      {errorMessage ? (
        <p className={fieldText.error} role="alert">
          {errorMessage}
        </p>
      ) : null}

      <AlertDialog
        confirmLabel="削除する"
        description="試合結果は残したまま、共有されているメモだけを削除します。"
        open={deleteOpen}
        pending={pending}
        title="試合メモを削除しますか？"
        tone="danger"
        onConfirm={remove}
        onOpenChange={setDeleteOpen}
      />
    </section>
  );
}
