import { useRef } from "react";

import type { NotificationSettingsEditor } from "@/features/masters/notifications/notificationSettingsEditing";
import { actionRowClass } from "@/shared/ui/actions/actionGroup";
import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import { FactList } from "@/shared/ui/data/FactList";
import { AlertDialog } from "@/shared/ui/feedback/Dialog";
import { Notice } from "@/shared/ui/feedback/Notice";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { CheckboxField } from "@/shared/ui/forms/CheckboxField";
import { readableTextWidthClass } from "@/shared/ui/layout/readableText";
import { contentText } from "@/shared/ui/typography";

const settings = [
  {
    kind: "ocrCompleted",
    label: "OCR完了",
    description: "1回の送信分がすべて終了すると、失敗も含めてまとめて通知します。",
  },
  {
    kind: "analysisCompleted",
    label: "分析完了",
    description: "分析結果の公開、または既存の分析結果を再利用できたときに通知します。",
  },
] as const;

const notificationFieldsClass = "grid min-w-0 gap-x-6 gap-y-4 md:grid-cols-2";

export function NotificationSettingsPanel({ editor }: { editor: NotificationSettingsEditor }) {
  const saveButtonRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const resource = editor.resource;
  const { issue, status } = editor;
  const reloadButton = (
    <Button
      pending={editor.refreshing}
      pendingLabel="読み込み中"
      size="sm"
      variant="secondary"
      onClick={async () => {
        if (await editor.reload()) headingRef.current?.focus();
      }}
    >
      {editor.dirty ? "現在の設定を読み込んで選び直す" : "現在の設定を読み込む"}
    </Button>
  );

  return (
    <>
      <section aria-label="Discord通知設定" className="grid min-w-0 gap-4">
        <header className="grid gap-1">
          <h2
            className={contentText.heading}
            id="notification-kinds-heading"
            ref={headingRef}
            tabIndex={-1}
          >
            通知する種類
          </h2>
          <p className={cn(contentText.body, readableTextWidthClass)}>
            Discordへ送る通知を選びます。全利用者に共通の設定です。
          </p>
        </header>
        {resource.status === "loading" ? (
          <div aria-label="通知設定を読み込み中" className={notificationFieldsClass} role="status">
            <Skeleton className="min-h-20" />
            <Skeleton className="min-h-20" />
          </div>
        ) : resource.status === "failed" ? (
          <Notice action={reloadButton} title="通知設定を読み込めません" tone="danger">
            <p>通信状態を確認して、もう一度読み込んでください。</p>
          </Notice>
        ) : resource.status === "ready" ? (
          <form
            aria-label="通知設定の編集"
            className="grid min-w-0 gap-6"
            onSubmit={(event) => {
              event.preventDefault();
              editor.submit();
            }}
          >
            <fieldset
              aria-labelledby="notification-kinds-heading"
              className={notificationFieldsClass}
              disabled={editor.disabled}
            >
              {settings.map(({ kind, label, description }) => (
                <CheckboxField
                  key={kind}
                  checked={resource.values[kind]}
                  description={description}
                  disabled={editor.disabled}
                  label={label}
                  onChange={(event) => editor.change(kind, event.target.checked)}
                  status={
                    <FactList
                      ariaLabel={`${label}の保存済み設定`}
                      items={[
                        {
                          id: kind,
                          label: "保存済み",
                          value: resource.savedValues[kind] ? "ON" : "OFF",
                        },
                      ]}
                      layout="inline"
                    />
                  }
                />
              ))}
            </fieldset>
            <div className="grid min-w-0 gap-4">
              <div className={cn("grid gap-1", contentText.supporting, readableTextWidthClass)}>
                <p>
                  OFFで保存すると、未送信の通知を取り消します。送信開始済みの通知は届く場合があります。
                </p>
                <p>ONにしても、過去の通知は送信されません。</p>
              </div>
              {issue || editor.stale ? (
                <Notice
                  action={editor.needsReload || editor.stale ? reloadButton : undefined}
                  title={!issue && editor.stale ? "現在の設定を確認できません" : undefined}
                  tone={issue?.tone ?? "warning"}
                >
                  {issue ? <p>{issue.message}</p> : null}
                  {editor.stale ? (
                    <p>
                      最後に確認できた保存内容を表示しています。
                      {editor.dirty ? "編集中の選択は保持しています。" : null}
                    </p>
                  ) : null}
                </Notice>
              ) : null}
              <div className="grid gap-2">
                <div className={actionRowClass}>
                  <Button
                    disabled={editor.actionsDisabled}
                    pending={editor.pending && !editor.confirmation.open}
                    pendingLabel="保存中"
                    ref={saveButtonRef}
                    type="submit"
                  >
                    保存
                  </Button>
                  <Button
                    disabled={editor.actionsDisabled}
                    variant="secondary"
                    onClick={editor.discardChanges}
                  >
                    変更を破棄
                  </Button>
                </div>
                <p className={cn("min-h-4", contentText.supporting)} role="status">
                  {editor.pending ? null : (
                    <>
                      {status.completion ? <span>{status.completion}</span> : null}
                      {status.checking ? (
                        <span>
                          {status.completion ? " " : null}保存済みの設定を確認しています。
                        </span>
                      ) : status.unsaved ? (
                        "未保存の変更があります"
                      ) : null}
                    </>
                  )}
                </p>
              </div>
            </div>
          </form>
        ) : null}
      </section>
      <AlertDialog
        open={editor.confirmation.open}
        onOpenChange={(open) => {
          if (!open) editor.confirmation.cancel();
        }}
        title="通知をOFFにして保存しますか？"
        description="全利用者に共通の通知設定を、次の内容で保存します。"
        confirmLabel="OFFにして保存"
        pending={editor.pending}
        pendingLabel="保存中"
        closeOnSuccess={false}
        finalFocus={() =>
          saveButtonRef.current && !saveButtonRef.current.disabled
            ? saveButtonRef.current
            : headingRef.current
        }
        onConfirm={editor.confirmation.save}
      >
        {resource.status === "ready" ? (
          <FactList
            ariaLabel="保存する通知設定"
            items={settings.map(({ kind, label }) => ({
              id: kind,
              label,
              value: resource.values[kind] ? "ON" : "OFF",
            }))}
            layout="inline"
          />
        ) : null}
        <p className={contentText.body}>
          OFFにする種類の待機中・再送待ちの通知を取り消します。再びONにしても、取り消した通知は送信されません。送信開始済みの通知は届く場合があります。
        </p>
      </AlertDialog>
    </>
  );
}
