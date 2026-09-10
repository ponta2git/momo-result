import { useNotificationSettingsPageModel } from "@/features/notificationSettings/useNotificationSettingsPageModel";
import { Button } from "@/shared/ui/actions/Button";
import { AlertDialog } from "@/shared/ui/feedback/Dialog";
import { Notice } from "@/shared/ui/feedback/Notice";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { CheckboxField } from "@/shared/ui/forms/CheckboxField";
import { PageContentSurface } from "@/shared/ui/layout/PageContentSurface";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { contentText } from "@/shared/ui/typography";

const settings = [
  { kind: "ocrCompleted", label: "OCR完了", description: "読取りの成功・要確認で通知します。" },
  {
    kind: "analysisCompleted",
    label: "分析完了",
    description: "分析結果の公開、または既存の分析結果を再利用できたときに通知します。",
  },
] as const;

export function NotificationSettingsPage() {
  const page = useNotificationSettingsPageModel();
  const resource = page.resource;
  const reloadButton = (
    <Button
      pending={page.refreshing}
      pendingLabel="読み込み中"
      size="sm"
      variant="secondary"
      onClick={page.reload}
    >
      {page.dirty ? "現在の設定を読み込んで選び直す" : "現在の設定を読み込む"}
    </Button>
  );

  return (
    <PageFrame width="narrow">
      <PageContentSurface className="grid gap-6">
        <div className="grid gap-2">
          <h1 className={contentText.primary}>Discord通知</h1>
          <p className={contentText.body}>
            全利用者に共通の設定です。通知する種類を選んで保存してください。
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
            className="grid gap-6"
            onSubmit={(event) => {
              event.preventDefault();
              page.submit();
            }}
          >
            <fieldset className="grid gap-6" disabled={page.disabled}>
              <legend className="sr-only">通知する種類</legend>
              {settings.map(({ kind, label, description }) => (
                <div className="grid gap-2" key={kind}>
                  <CheckboxField
                    checked={resource.values[kind]}
                    description={description}
                    label={label}
                    onChange={(event) => page.change(kind, event.target.checked)}
                  />
                  <p className={`${contentText.supporting} pl-8`}>
                    保存済み：{resource.confirmed[kind].enabled ? "ON" : "OFF"}
                  </p>
                </div>
              ))}
            </fieldset>
            <p className={contentText.body}>
              OFFで保存すると、待機中・再送待ちの通知も取り消します。再びONにしても過去の通知は送りません。送信開始済みの通知は届く場合があります。
            </p>
            {page.feedback ? (
              <Notice
                action={page.needsReload && !page.stale ? reloadButton : undefined}
                tone={page.feedback.tone}
              >
                <p>{page.feedback.message}</p>
              </Notice>
            ) : null}
            {page.stale ? (
              <Notice action={reloadButton} title="現在の設定を確認できません" tone="warning">
                <p>最後に確認できた保存内容を表示しています。編集中の選択は保持しています。</p>
              </Notice>
            ) : null}
            <div className="flex flex-wrap items-center gap-3 border-t border-[var(--color-border)] pt-4">
              <Button
                disabled={!page.dirty || page.disabled}
                pending={page.pending}
                pendingLabel="保存中"
                type="submit"
              >
                保存
              </Button>
              <Button
                disabled={!page.dirty || page.disabled}
                variant="secondary"
                onClick={page.reset}
              >
                変更を戻す
              </Button>
              {page.dirty ? (
                <p className={contentText.supporting} role="status">
                  未保存の変更があります
                </p>
              ) : null}
            </div>
          </form>
        ) : null}
      </PageContentSurface>
      <AlertDialog
        open={page.confirmation.open}
        onOpenChange={page.confirmation.setOpen}
        title="通知をOFFにして保存しますか？"
        description="OFFにする種類の待機中・再送待ちの通知を取り消します。再びONにしても、取り消した通知は送信されません。"
        confirmLabel="OFFにして保存"
        pending={page.pending}
        closeOnSuccess={false}
        onConfirm={page.confirmation.save}
      />
    </PageFrame>
  );
}
