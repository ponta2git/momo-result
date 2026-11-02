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
import { cn } from "@/shared/ui/cn";
import { Dialog, DialogFooter } from "@/shared/ui/feedback/Dialog";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { SegmentedControl } from "@/shared/ui/forms/SegmentedControl";
import { TabsPanel, TabsRoot } from "@/shared/ui/forms/Tabs";
import { ContentWithActions } from "@/shared/ui/layout/ContentWithActions";
import { contentText, fieldText } from "@/shared/ui/typography";

type SourceImagePanelProps = {
  accountId?: string | undefined;
  loading: boolean;
  matchDraftId: string;
  preferredKind: SourceImageKind | undefined;
  sourceImages: SourceImageItem[] | undefined;
  snapshotChanged?: boolean;
};

const archivePendingLabel = "保存中…";
const followModeOptions = [
  { label: "自動追従", value: "auto" },
  { label: "固定", value: "fixed" },
];

/** Every state keeps the 16:9 frame and the caption row, so switching kinds does not resize the panel. */
const sourceImageFrameClass = "grid aspect-video w-full min-w-0 place-items-center";
const sourceImageCaptionClass = "flex min-h-11 items-center pointer-fine:min-h-9";

function SourceImageLoadingFrame({ detail, label }: { detail: string; label: string }) {
  return (
    <div aria-busy="true" aria-label={label} className="grid gap-2">
      <Skeleton className="aspect-video w-full rounded-xs" />
      <p className={cn(contentText.body, sourceImageCaptionClass)}>{detail}</p>
    </div>
  );
}

export function SourceImagePanel(props: SourceImagePanelProps) {
  return (
    <SourceImagePanelContent
      key={JSON.stringify([props.accountId, props.matchDraftId])}
      {...props}
    />
  );
}

function SourceImagePanelContent({
  accountId,
  loading,
  matchDraftId,
  preferredKind,
  sourceImages,
  snapshotChanged = false,
}: SourceImagePanelProps) {
  const panel = useSourceImagePanelState({
    accountId,
    loading,
    matchDraftId,
    preferredKind,
    sourceImages,
    snapshotChanged,
  });

  return (
    <section className="grid gap-4 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-[var(--color-text-primary)]">
      <div className="grid gap-1">
        <ContentWithActions
          actions={
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
          }
        >
          <div className="grid gap-1">
            <h2 className={contentText.heading}>元画像参照</h2>
            <p className={cn(contentText.supporting, "text-pretty")}>
              自動追従では、選択中の入力セルに対応する画像を表示します。
            </p>
          </div>
        </ContentWithActions>
        {!loading && panel.availableImageCount === 0 ? (
          <p className={contentText.body}>保存できる元画像がありません。</p>
        ) : null}
        {panel.archiveDownloaded ? (
          <p className={contentText.supporting} role="status">
            ダウンロードを開始しました
          </p>
        ) : null}
        {panel.archiveError ? (
          <p className={fieldText.error} role="alert">
            {panel.archiveError}
          </p>
        ) : null}
        {panel.sourceImagesChanged ? (
          <p className={fieldText.error} role="alert">
            元画像または記録が更新されています。入力内容はこの画面に保持されています。
            未保存の入力を控えてから画面を再読み込みし、最新の画像と読み取り結果を確認してください。
          </p>
        ) : null}
      </div>

      <TabsRoot
        value={panel.activeKind}
        onValueChange={(value) => {
          if (typeof value !== "string") return;
          const kind = parseSourceImageKind(value);
          if (kind) panel.handleSourceImageTabChange(kind);
        }}
      >
        <div className="grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="shrink-0">
              <SegmentedControl
                label="元画像の追従方法"
                options={followModeOptions}
                value={panel.followMode}
                onValueChange={panel.handleFollowModeChange}
              />
            </div>
            <SourceImageTabs />
          </div>

          {sourceImageKinds.map((kind) => (
            <TabsPanel keepMounted key={kind} value={kind}>
              {panel.activeKind === kind ? (
                <div className="rounded-sm border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3">
                  {loading ? (
                    <SourceImageLoadingFrame
                      detail="画像一覧を取得しています。"
                      label="元画像を取得中"
                    />
                  ) : panel.activeState?.status === "available" &&
                    (!panel.activeImage || panel.activeImage.status === "loading") ? (
                    <SourceImageLoadingFrame
                      detail="元画像を読み込んでいます。"
                      label={`${sourceImageKindLabels[panel.activeState.kind]}の元画像を読み込み中`}
                    />
                  ) : panel.activeState?.status === "available" &&
                    panel.activeImage?.status === "error" ? (
                    <div className="grid gap-2">
                      <div className={sourceImageFrameClass}>
                        <p className={fieldText.error} role="alert">
                          元画像を読み込めませんでした。
                        </p>
                      </div>
                      <div className={sourceImageCaptionClass}>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={panel.handleActiveImageRetry}
                        >
                          元画像を再読み込み
                        </Button>
                      </div>
                    </div>
                  ) : panel.activeImage?.status === "replaced" ? (
                    <div className="grid gap-2">
                      <div className={sourceImageFrameClass}>
                        <p className={cn(contentText.body, "text-center text-pretty")}>
                          元画像が差し替えられたため、この画面では表示できません。
                        </p>
                      </div>
                      <div className={sourceImageCaptionClass} />
                    </div>
                  ) : panel.activeState?.status === "available" && panel.displayUrl ? (
                    <div className="grid gap-2">
                      <div className={sourceImageFrameClass}>
                        <img
                          alt={`${sourceImageKindLabels[panel.activeState.kind]}の元画像`}
                          className="size-full min-h-0 min-w-0 rounded-xs bg-[var(--color-media-canvas)] object-contain"
                          src={panel.displayUrl}
                        />
                      </div>
                      <ContentWithActions
                        actions={
                          <Button size="sm" variant="secondary" onClick={panel.handlePreviewOpen}>
                            拡大
                          </Button>
                        }
                      >
                        <p className={cn(contentText.supporting, sourceImageCaptionClass)}>
                          {panel.activeState.description}
                        </p>
                      </ContentWithActions>
                    </div>
                  ) : panel.activeState?.status === "missing" ? (
                    <div className="grid gap-2">
                      <div className={sourceImageFrameClass}>
                        <p className={cn(contentText.body, "text-center text-pretty")}>
                          {panel.activeState.description}
                        </p>
                      </div>
                      <div className={sourceImageCaptionClass} />
                    </div>
                  ) : null}
                </div>
              ) : null}
            </TabsPanel>
          ))}
        </div>
      </TabsRoot>

      {panel.previewKind && panel.previewUrl ? (
        <SourceImagePreviewDialog
          kind={panel.previewKind}
          open={panel.previewOpen}
          url={panel.previewUrl}
          onClose={panel.handlePreviewClose}
        />
      ) : null}

      <Dialog
        open={panel.archiveConfirmOpen}
        title="元画像がすべてそろっていません"
        onOpenChange={panel.handleArchiveDialogOpenChange}
      >
        <div className="grid gap-4">
          <p className={cn(contentText.body, "text-pretty")}>
            {`保存できる元画像は${panel.expectedImageCount}枚中${panel.availableImageCount}枚です。不足している画像はZIPに含まれません。このまま保存しますか？`}
          </p>
          <DialogFooter>
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
          </DialogFooter>
        </div>
      </Dialog>
    </section>
  );
}
