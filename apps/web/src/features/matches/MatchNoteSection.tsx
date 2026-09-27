import { useEffect, useRef, useState } from "react";

import type { MatchNoteEditor } from "@/features/matches/useMatchNoteEditor";
import { matchNoteMaximumCharacters } from "@/features/matches/workspace/review/confirmMatchFormSchema";
import type { MatchDetailResponse } from "@/shared/api/matches";
import { formatDateTimeLong } from "@/shared/lib/dateTime";
import { UnsavedChangesGuard } from "@/shared/navigation/UnsavedChangesGuard";
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
  editor: MatchNoteEditor;
};

export function MatchNoteSection({ match, editor }: MatchNoteSectionProps) {
  const editActionRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const restoreActionFocus = useRef(false);
  const {
    cancel,
    conflict,
    count,
    deleteOpen,
    dirty,
    draft,
    editing,
    errorMessage,
    normalizedDraft,
    pending,
    remove,
    save,
    setDeleteOpen,
    setDraft,
    startEditing,
    tooLong,
  } = editor;

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (!restoreActionFocus.current || deleteOpen || pending || editor.refreshing) return;
    restoreActionFocus.current = false;
    if (document.activeElement === document.body) editActionRef.current?.focus();
  }, [deleteOpen, editor.refreshing, pending]);

  return (
    <section aria-labelledby="match-note-heading" className="grid gap-4">
      <ContentWithActions
        actions={
          editing ? null : (
            <div
              aria-label="試合メモの操作"
              className="flex shrink-0 flex-wrap items-center gap-2"
              role="group"
            >
              <Button
                disabled={pending || editor.refreshing}
                ref={editActionRef}
                size="sm"
                variant="secondary"
                onClick={startEditing}
              >
                {match.note.body ? "編集" : "メモを追加"}
              </Button>
              {match.note.body ? (
                <Button
                  disabled={pending || editor.refreshing}
                  size="sm"
                  variant="dangerQuiet"
                  onClick={() => setDeleteOpen(true)}
                >
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
                  ref={inputRef}
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
                    editor.refreshing ||
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

      <p className={contentText.supporting} role="status">
        {editor.successMessage}
      </p>

      {editor.refreshing ? (
        <p className={contentText.supporting} role="status">
          メモの最新表示を確認しています。
        </p>
      ) : null}
      {editor.refreshFailed ? (
        <Notice
          action={
            <Button
              disabled={editor.refreshing}
              pending={editor.refreshing}
              pendingLabel="確認中"
              size="sm"
              variant="secondary"
              onClick={() => void editor.retryDisplayRefresh()}
            >
              メモの表示を再取得
            </Button>
          }
          tone="warning"
          title="保存後の表示を更新できませんでした"
        >
          保存は完了しています。更新者と更新日時は、試合詳細を再取得すると確認できます。
        </Notice>
      ) : null}

      {errorMessage ? (
        <p className={fieldText.error} role="alert">
          {errorMessage}
        </p>
      ) : null}

      <AlertDialog
        confirmLabel="削除する"
        description="試合結果は残したまま、共有されているメモだけを削除します。"
        finalFocus={editActionRef}
        open={deleteOpen}
        pending={pending}
        title="試合メモを削除しますか？"
        tone="danger"
        onConfirm={() => {
          restoreActionFocus.current = true;
          remove();
        }}
        onOpenChange={setDeleteOpen}
      />
    </section>
  );
}

/** Mount beside ready/terminal content so a confirmed 404 cannot remove the guard. */
export function MatchNoteNavigationGuard({ editor }: { editor: MatchNoteEditor }) {
  return (
    <UnsavedChangesGuard
      description="入力した試合メモはまだ保存されていません。このページに残れば編集を続けられます。"
      model={{
        dirty: editor.dirty,
        navigationAllowedRef: editor.navigationAllowedRef,
        onDiscard: editor.cancel,
      }}
      pending={editor.pending}
      pendingDescription="試合メモの処理結果が分かるまで、このページでお待ちください。送信済みの保存や削除を移動操作で取り消すことはできません。"
    />
  );
}

/** Only the local unsaved text survives deletion; the deleted result is not rendered again. */
export function MatchNoteRecovery({ editor }: { editor: MatchNoteEditor }) {
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [copyMessage, setCopyMessage] = useState("");
  if (!editor.dirty) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(editor.draft);
      setCopyMessage("未保存のメモをコピーしました。");
    } catch {
      textRef.current?.focus();
      textRef.current?.select();
      setCopyMessage("本文を選択しました。コピーして保管してください。");
    }
  };

  return (
    <section aria-labelledby="unsaved-match-note-heading" className="grid gap-4">
      <h2 className={contentText.heading} id="unsaved-match-note-heading">
        未保存の試合メモ
      </h2>
      <p className={contentText.body}>
        試合を取得できないため保存できません。入力した本文はこの画面に残しています。
      </p>
      <TextareaControl
        aria-label="退避した未保存の試合メモ"
        minHeight="md"
        readOnly
        ref={textRef}
        resize="vertical"
        textFlow="relaxed"
        value={editor.draft}
      />
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void copy()} variant="secondary">
          メモをコピー
        </Button>
        <Button disabled={editor.pending} onClick={editor.cancel} variant="dangerQuiet">
          未保存のメモを破棄
        </Button>
      </div>
      {copyMessage ? <p role="status">{copyMessage}</p> : null}
    </section>
  );
}
