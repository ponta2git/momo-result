import { useRef } from "react";

import type { NotificationSettingsModel } from "@/features/masters/notifications/useNotificationSettingsModel";
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
  { kind: "ocrCompleted", label: "OCR完了", description: "読取りの成功・要確認で通知します。" },
  {
    kind: "analysisCompleted",
    label: "分析完了",
    description: "分析結果の公開、または既存の分析結果を再利用できたときに通知します。",
  },
] as const;

export function NotificationSettingsPanel({ model: page }: { model: NotificationSettingsModel }) {
  const saveButtonRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const resource = page.resource;
  const issue = page.feedback?.tone === "success" ? undefined : page.feedback;
  const completion = page.feedback?.tone === "success" ? page.feedback.message : undefined;
  const checking = page.refreshing && !page.pending && !page.needsReload && !page.stale;
  const reloadButton = (
    <Button
      pending={page.refreshing}
      pendingLabel="読み込み中"
      size="sm"
      variant="secondary"
      onClick={async () => {
        if (await page.reload()) headingRef.current?.focus();
      }}
    >
      {page.dirty ? "現在の設定を読み込んで選び直す" : "現在の設定を読み込む"}
    </Button>
  );

  return (
    <>
      <section aria-label="Discord通知設定" className={cn("grid gap-4", readableTextWidthClass)}>
        <div className="grid gap-1">
          <h2
            className={contentText.heading}
            id="notification-kinds-heading"
            ref={headingRef}
            tabIndex={-1}
          >
            通知する種類
          </h2>
          <p className={contentText.body}>
            Discordへ送る通知を選びます。全利用者に共通の設定です。
          </p>
        </div>
        {resource.status === "loading" ? (
          <div aria-label="通知設定を読み込み中" className="grid gap-4" role="status">
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
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              page.submit();
            }}
          >
            <fieldset
              aria-labelledby="notification-kinds-heading"
              className="grid min-w-0 gap-4"
              disabled={page.disabled}
            >
              {settings.map(({ kind, label, description }) => (
                <CheckboxField
                  key={kind}
                  checked={resource.values[kind]}
                  description={description}
                  disabled={page.disabled}
                  label={label}
                  onChange={(event) => page.change(kind, event.target.checked)}
                  status={
                    <FactList
                      ariaLabel={`${label}の保存済み設定`}
                      items={[
                        {
                          id: kind,
                          label: "保存済み",
                          value: resource.confirmed[kind].enabled ? "ON" : "OFF",
                        },
                      ]}
                      layout="inline"
                    />
                  }
                />
              ))}
            </fieldset>
            <div className={cn("grid gap-1", contentText.supporting)}>
              <p>
                OFFで保存すると、未送信の通知を取り消します。送信開始済みの通知は届く場合があります。
              </p>
              <p>ONにしても、過去の通知は送信されません。</p>
            </div>
            {issue || page.stale ? (
              <Notice
                action={page.needsReload || page.stale ? reloadButton : undefined}
                title={!issue && page.stale ? "現在の設定を確認できません" : undefined}
                tone={issue?.tone ?? "warning"}
              >
                {issue ? <p>{issue.message}</p> : null}
                {page.stale ? (
                  <p>
                    最後に確認できた保存内容を表示しています。
                    {page.dirty ? "編集中の選択は保持しています。" : null}
                  </p>
                ) : null}
              </Notice>
            ) : null}
            <div className="grid gap-2">
              <div className={actionRowClass}>
                <Button
                  disabled={!page.dirty || page.disabled}
                  pending={page.pending && !page.confirmation.open}
                  pendingLabel="保存中"
                  ref={saveButtonRef}
                  type="submit"
                >
                  保存
                </Button>
                <Button
                  disabled={!page.dirty || page.disabled}
                  variant="secondary"
                  onClick={page.reset}
                >
                  変更を破棄
                </Button>
              </div>
              <p className={cn("min-h-4", contentText.supporting)} role="status">
                {page.pending ? null : (
                  <>
                    {completion ? <span>{completion}</span> : null}
                    {checking ? (
                      <span>{completion ? " " : null}保存済みの設定を確認しています。</span>
                    ) : !page.feedback && !page.needsReload && page.dirty ? (
                      "未保存の変更があります"
                    ) : null}
                  </>
                )}
              </p>
            </div>
          </form>
        ) : null}
      </section>
      <AlertDialog
        open={page.confirmation.open}
        onOpenChange={page.confirmation.setOpen}
        title="通知をOFFにして保存しますか？"
        description="全利用者に共通の通知設定を、次の内容で保存します。"
        confirmLabel="OFFにして保存"
        pending={page.pending}
        pendingLabel="保存中"
        closeOnSuccess={false}
        finalFocus={() =>
          saveButtonRef.current && !saveButtonRef.current.disabled
            ? saveButtonRef.current
            : headingRef.current
        }
        onConfirm={page.confirmation.save}
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
