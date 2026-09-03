import { useMatchNoteEditor } from "@/features/matches/useMatchNoteEditor";
import { MatchWorkspaceNavigationGuard } from "@/features/matches/workspace/MatchWorkspaceNavigationGuard";
import { matchNoteMaximumCharacters } from "@/features/matches/workspace/review/confirmMatchFormSchema";
import type { MatchDetailResponse } from "@/shared/api/matches";
import { formatDateTimeLong } from "@/shared/lib/dateTime";
import { Button } from "@/shared/ui/actions/Button";
import { AlertDialog } from "@/shared/ui/feedback/Dialog";
import { Notice } from "@/shared/ui/feedback/Notice";
import { TextareaControl } from "@/shared/ui/forms/Control";

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
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2
            className="text-base font-semibold text-[var(--color-text-primary)]"
            id="match-note-heading"
          >
            試合メモ
          </h2>
          <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
            試合後の振り返りを、この結果を見られる人と共有します。
          </p>
        </div>
        {editing ? null : (
          <div
            aria-label="試合メモの操作"
            className="flex shrink-0 flex-wrap items-center justify-end gap-2"
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
        )}
      </div>

      {editing ? (
        <div className="grid gap-4">
          <div className="grid gap-1">
            <div className="flex justify-end">
              <span
                aria-live="polite"
                className={
                  tooLong
                    ? "text-xs font-semibold text-[var(--color-danger)] tabular-nums"
                    : "text-xs text-[var(--color-text-secondary)] tabular-nums"
                }
              >
                {count} / {matchNoteMaximumCharacters}
              </span>
            </div>
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
              <p
                className="text-xs font-semibold text-[var(--color-danger)]"
                id="match-note-detail-error"
                role="alert"
              >
                試合メモは{matchNoteMaximumCharacters}字以内で入力してください。
              </p>
            ) : null}
          </div>
          {conflict ? (
            <Notice tone="warning" title="別の利用者が先に更新しました">
              <div className="grid gap-3 text-sm">
                <div>
                  <p className="font-semibold">保存済みの最新版</p>
                  <p className="mt-1 break-words whitespace-pre-wrap">
                    {conflict.latest.body ?? "（メモなし）"}
                  </p>
                </div>
                <div>
                  <p className="font-semibold">あなたの入力</p>
                  <p className="mt-1 break-words whitespace-pre-wrap">{conflict.draft}</p>
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
                pending || tooLong || normalizedDraft.trim().length === 0 || (!dirty && !conflict)
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
          <p className="text-sm leading-6 break-words whitespace-pre-wrap text-[var(--color-text-primary)]">
            {match.note.body}
          </p>
          {match.note.updatedAt ? (
            <p className="text-xs text-[var(--color-text-secondary)]">
              {match.note.updatedByDisplayName ?? "利用者"}が
              {formatDateTimeLong(match.note.updatedAt)}に更新
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-[var(--color-text-secondary)]">まだメモはありません。</p>
      )}

      {errorMessage ? (
        <p className="text-sm text-[var(--color-danger)]" role="alert">
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
