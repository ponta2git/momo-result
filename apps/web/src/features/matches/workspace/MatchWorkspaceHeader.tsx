import type { MatchWorkspaceController } from "@/features/matches/workspace/useMatchWorkspaceController";
import { Button } from "@/shared/ui/actions/Button";
import { AlertDialog } from "@/shared/ui/feedback/Dialog";
import { PageHeader } from "@/shared/ui/layout/PageHeader";

type MatchWorkspaceHeaderProps = {
  header: MatchWorkspaceController["header"];
};

export function MatchWorkspaceHeader({ header }: MatchWorkspaceHeaderProps) {
  return (
    <PageHeader
      description={
        <>
          {header.pageDescription}
          {header.useSampleDrafts ? (
            <span className="mt-2 block w-fit rounded-full border border-[var(--color-warning)]/65 bg-[var(--color-warning)]/18 px-3 py-1 text-sm font-semibold text-[var(--color-text-primary)]">
              サンプルの読み取り結果で表示中
            </span>
          ) : null}
        </>
      }
      eyebrow="試合記録"
      title={header.pageTitle}
      actions={
        <>
          {header.cancelDraft.canCancel ? (
            <AlertDialog
              cancelLabel="キャンセル"
              confirmLabel={header.cancelDraft.confirmPending ? "削除中…" : "削除する"}
              pending={header.cancelDraft.confirmPending}
              description="この確定前の記録を削除します。元に戻せません。"
              open={header.cancelDraft.confirmOpen}
              title="確定前の記録を削除しますか？"
              trigger={
                <Button
                  disabled={header.cancelDraft.disabled}
                  variant="danger"
                  onClick={header.cancelDraft.onTrigger}
                >
                  {header.cancelDraft.confirmPending ? "削除中…" : "確定前の記録を削除"}
                </Button>
              }
              onConfirm={header.cancelDraft.onConfirm}
              onOpenChange={header.cancelDraft.onOpenChange}
            />
          ) : null}
          {header.mastersNavigation.show ? (
            <Button
              pending={header.mastersNavigation.pending}
              pendingLabel="移動中…"
              variant="secondary"
              onClick={header.mastersNavigation.onClick}
            >
              設定管理へ
            </Button>
          ) : null}
        </>
      }
    />
  );
}
