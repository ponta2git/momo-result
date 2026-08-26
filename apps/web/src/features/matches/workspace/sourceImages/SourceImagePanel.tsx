import { SourceImagePreviewDialog } from "@/features/matches/workspace/sourceImages/SourceImagePreviewDialog";
import { SourceImageTabs } from "@/features/matches/workspace/sourceImages/SourceImageTabs";
import {
  parseSourceImageKind,
  sourceImageKindLabels,
  sourceImageKinds,
} from "@/features/matches/workspace/sourceImages/sourceImageTypes";
import type {
  SourceImageItem,
  SourceImageKind,
} from "@/features/matches/workspace/sourceImages/sourceImageTypes";
import { useSourceImagePanelState } from "@/features/matches/workspace/sourceImages/useSourceImagePanelState";
import { Button } from "@/shared/ui/actions/Button";
import { Dialog } from "@/shared/ui/feedback/Dialog";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { SegmentedControl } from "@/shared/ui/forms/SegmentedControl";
import { TabsPanel, TabsRoot } from "@/shared/ui/forms/Tabs";
import { Card } from "@/shared/ui/layout/Card";

type SourceImagePanelProps = {
  loading: boolean;
  matchDraftId: string;
  preferredKind: SourceImageKind | undefined;
  sourceImages: SourceImageItem[] | undefined;
};

const archivePendingLabel = "保存中…";
const followModeOptions = [
  { label: "自動追従", value: "auto" },
  { label: "固定", value: "fixed" },
];

function SourceImageLoadingFrame({ detail, label }: { detail: string; label: string }) {
  return (
    <div aria-busy="true" aria-label={label} className="grid min-h-[13rem] gap-3">
      <Skeleton className="h-[10rem] w-full rounded-[var(--radius-sm)]" />
      <p className="text-sm text-[var(--color-text-secondary)]">{detail}</p>
    </div>
  );
}

export function SourceImagePanel({
  loading,
  matchDraftId,
  preferredKind,
  sourceImages,
}: SourceImagePanelProps) {
  const panel = useSourceImagePanelState({
    loading,
    matchDraftId,
    preferredKind,
    sourceImages,
  });

  return (
    <Card className="h-fit p-4 shadow-none">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-[var(--color-text-primary)]">元画像参照</h2>
          <span className="text-xs font-semibold text-[var(--color-text-secondary)]">
            {sourceImageKindLabels[panel.activeKind]}
          </span>
        </div>
        <Button
          disabled={panel.archiveSaveDisabled}
          pending={panel.archiveSaving}
          pendingLabel={archivePendingLabel}
          size="sm"
          variant="secondary"
          onClick={panel.handleArchiveSaveRequest}
        >
          元画像を保存
        </Button>
      </div>
      <p className="mt-1 text-xs text-pretty text-[var(--color-text-secondary)]">
        自動追従では、選択中の入力セルに対応する画像を表示します。
      </p>
      {!loading && panel.availableImageCount === 0 ? (
        <p className="mt-2 text-xs text-[var(--color-text-secondary)]">
          保存できる元画像がありません。
        </p>
      ) : null}
      {panel.archiveError ? (
        <p className="mt-2 text-sm text-[var(--color-danger)]" role="alert">
          {panel.archiveError}
        </p>
      ) : null}

      <TabsRoot
        value={panel.activeKind}
        onValueChange={(value) => {
          if (typeof value !== "string") return;
          const kind = parseSourceImageKind(value);
          if (kind) panel.handleSourceImageTabChange(kind);
        }}
      >
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <SegmentedControl
            className="shrink-0"
            label="元画像の追従方法"
            options={followModeOptions}
            value={panel.followMode}
            onValueChange={panel.handleFollowModeChange}
          />
          <SourceImageTabs />
        </div>

        {sourceImageKinds.map((kind) => (
          <TabsPanel className="mt-3" keepMounted key={kind} value={kind}>
            {panel.activeKind === kind ? (
              <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3">
                {loading ? (
                  <SourceImageLoadingFrame
                    detail="画像一覧を取得しています。"
                    label="元画像を取得中"
                  />
                ) : null}

                {!loading &&
                panel.activeState?.status === "available" &&
                (!panel.activeImage || panel.activeImage.status === "loading") ? (
                  <SourceImageLoadingFrame
                    detail="元画像を読み込んでいます。"
                    label={`${sourceImageKindLabels[panel.activeState.kind]}の元画像を読み込み中`}
                  />
                ) : null}

                {!loading &&
                panel.activeState?.status === "available" &&
                panel.activeImage?.status === "error" ? (
                  <div className="grid justify-items-start gap-3">
                    <p className="text-sm text-[var(--color-danger)]" role="alert">
                      元画像を読み込めませんでした。
                    </p>
                    <Button size="sm" variant="secondary" onClick={panel.handleActiveImageRetry}>
                      元画像を再読み込み
                    </Button>
                  </div>
                ) : null}

                {!loading && panel.activeState?.status === "available" && panel.displayUrl ? (
                  <>
                    <img
                      alt={`${sourceImageKindLabels[panel.activeState.kind]}の元画像`}
                      className="h-[13rem] w-full rounded-[var(--radius-sm)] bg-[var(--momo-night-900)] object-contain"
                      src={panel.displayUrl}
                    />
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <p className="text-xs text-[var(--color-text-secondary)]">
                        {panel.activeState.description}
                      </p>
                      <Button variant="secondary" onClick={panel.handlePreviewOpen}>
                        拡大
                      </Button>
                    </div>
                  </>
                ) : null}

                {!loading && panel.activeState?.status === "missing" ? (
                  <p className="text-sm text-[var(--color-text-secondary)]">
                    {panel.activeState.description}
                  </p>
                ) : null}
              </div>
            ) : null}
          </TabsPanel>
        ))}
      </TabsRoot>

      {panel.previewKind && panel.previewUrl ? (
        <SourceImagePreviewDialog
          kind={panel.previewKind}
          url={panel.previewUrl}
          onClose={panel.handlePreviewClose}
        />
      ) : null}

      {panel.archiveConfirmOpen ? (
        <Dialog
          open
          title="元画像がすべてそろっていません"
          onOpenChange={panel.handleArchiveDialogOpenChange}
        >
          <p className="text-sm leading-6 text-pretty text-[var(--color-text-secondary)]">
            {`保存できる元画像は${panel.expectedImageCount}枚中${panel.availableImageCount}枚です。不足している画像はZIPに含まれません。このまま保存しますか？`}
          </p>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={panel.handleArchiveCancel}>
              キャンセル
            </Button>
            <Button
              pending={panel.archiveSaving}
              pendingLabel={archivePendingLabel}
              onClick={panel.handleArchiveSaveConfirmed}
            >
              保存する
            </Button>
          </div>
        </Dialog>
      ) : null}
    </Card>
  );
}
