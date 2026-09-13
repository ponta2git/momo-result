import { useRef } from "react";

import { useNotificationSettingsPageModel } from "@/features/notificationSettings/useNotificationSettingsPageModel";
import { actionRowClass } from "@/shared/ui/actions/actionGroup";
import { Button } from "@/shared/ui/actions/Button";
import { FactList } from "@/shared/ui/data/FactList";
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
  const saveButtonRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const page = useNotificationSettingsPageModel();
  const resource = page.resource;
  const editingStatus = page.refreshing
    ? "保存済みの設定を確認しています。"
    : page.dirty
      ? "未保存の変更があります"
      : page.feedback
        ? undefined
        : "通知の選択を変更すると保存できます。";
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
      <PageContentSurface aria-label="Discord通知設定" className="grid gap-6" role="region">
        <div className="grid gap-2">
          <h2
            className={contentText.heading}
            id="notification-kinds-heading"
            ref={headingRef}
            tabIndex={-1}
          >
            通知する種類
          </h2>
          <p className={contentText.body}>
            Discordへ送る通知を選びます。全利用者に共通の設定で、保存すると反映されます。
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
            className="grid gap-6"
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
                <div
                  className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start sm:gap-6"
                  key={kind}
                >
                  <CheckboxField
                    checked={resource.values[kind]}
                    description={description}
                    disabled={page.disabled}
                    label={label}
                    onChange={(event) => page.change(kind, event.target.checked)}
                  />
                  <div className="pl-8 sm:pt-2 sm:pl-0">
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
                  </div>
                </div>
              ))}
            </fieldset>
            <div className="grid gap-2">
              {page.turnsOff ? (
                <p className={contentText.body}>
                  OFFで保存すると、未送信の通知も取り消します。送信開始済みの通知は届く場合があります。
                </p>
              ) : null}
              <p className={contentText.body}>ONにしても、過去の通知は送信されません。</p>
            </div>
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
            <div className="grid gap-2">
              <div className={actionRowClass}>
                <Button
                  disabled={!page.dirty || page.disabled}
                  pending={page.pending}
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
              {!page.pending && !page.needsReload && editingStatus ? (
                <p className={contentText.body} role="status">
                  {editingStatus}
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
        description="全利用者に共通の通知設定を、次の内容で保存します。"
        confirmLabel="OFFにして保存"
        pending={page.pending}
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
    </PageFrame>
  );
}
