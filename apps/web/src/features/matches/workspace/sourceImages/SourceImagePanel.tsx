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

type SourceImagePanelProps = {
  accountId?: string | undefined;
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
    <div aria-busy="true" aria-label={label} className="grid min-h-[13rem] gap-1">
      <Skeleton className="h-[10rem] w-full rounded-xs 2xl:aspect-video 2xl:h-auto" />
      <p className="text-sm text-[var(--color-text-secondary)]">{detail}</p>
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
}: SourceImagePanelProps) {
  const panel = useSourceImagePanelState({
    accountId,
    loading,
    matchDraftId,
    preferredKind,
    sourceImages,
  });

  return (
    <section className="grid gap-4 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-[var(--color-text-primary)]">
      <div>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-[var(--color-text-primary)]">元画像参照</h2>
            <span className="mt-0.5 block text-xs font-semibold text-[var(--color-text-secondary)]">
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
          <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
            保存できる元画像がありません。
          </p>
        ) : null}
        {panel.archiveError ? (
          <p className="mt-1 text-sm text-[var(--color-danger)]" role="alert">
            {panel.archiveError}
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
              <div className="mt-4">
                <div className="rounded-sm border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3">
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
                    <div className="grid justify-items-start gap-2">
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
                      <div className="grid h-[13rem] w-full 2xl:aspect-video 2xl:h-auto">
                        <img
                          alt={`${sourceImageKindLabels[panel.activeState.kind]}の元画像`}
                          className="size-full min-h-0 min-w-0 rounded-xs bg-[var(--color-media-canvas)] object-contain"
                          src={panel.displayUrl}
                        />
                      </div>
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
              </div>
            ) : null}
          </TabsPanel>
        ))}
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
    </section>
  );
}
