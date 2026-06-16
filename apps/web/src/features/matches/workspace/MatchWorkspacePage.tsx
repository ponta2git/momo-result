import { useCallback, useRef } from "react";
import { Link } from "react-router-dom";

import { MatchConfirmDialog } from "@/features/matches/workspace/MatchConfirmDialog";
import { MatchFormActions } from "@/features/matches/workspace/MatchFormActions";
import type { WorkspaceMode } from "@/features/matches/workspace/matchFormTypes";
import { MatchSetupSection } from "@/features/matches/workspace/MatchSetupSection";
import { ScoreGrid } from "@/features/matches/workspace/scoreGrid/ScoreGrid";
import { SourceImagePanel } from "@/features/matches/workspace/sourceImages/SourceImagePanel";
import { useMatchWorkspaceController } from "@/features/matches/workspace/useMatchWorkspaceController";
import { Button } from "@/shared/ui/actions/Button";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { cn } from "@/shared/ui/cn";
import { AlertDialog } from "@/shared/ui/feedback/Dialog";
import { LiveRegion } from "@/shared/ui/feedback/LiveRegion";
import { Notice } from "@/shared/ui/feedback/Notice";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { Card } from "@/shared/ui/layout/Card";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { PageHeader } from "@/shared/ui/layout/PageHeader";

type MatchWorkspacePageProps = {
  matchDraftId?: string;
  matchId?: string;
  matchSessionId?: string;
  mode: WorkspaceMode;
};

function MatchWorkspaceLoading({
  description = "試合内容を取得しています。",
  title = "試合フォームを読み込み中",
}: {
  description?: string;
  title?: string;
}) {
  return (
    <PageFrame aria-busy="true" aria-label={title} className="gap-5" width="workspace">
      <PageHeader description={description} eyebrow="試合記録" title={title} />

      <Card>
        <div className="grid gap-3 md:grid-cols-4">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      </Card>

      <Card className="p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {["player-a", "player-b", "player-c", "player-d"].map((id) => (
            <div
              key={id}
              className="grid gap-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] p-3"
            >
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          ))}
        </div>
      </Card>
    </PageFrame>
  );
}

export function MatchWorkspacePage({
  matchDraftId,
  matchId,
  matchSessionId,
  mode,
}: MatchWorkspacePageProps) {
  const controller = useMatchWorkspaceController({ matchDraftId, matchId, matchSessionId, mode });
  const primaryActionRef = useRef<HTMLButtonElement>(null);
  const onRequestSubmitFocus = useCallback(() => {
    primaryActionRef.current?.focus();
  }, []);
  const {
    baseErrors,
    canCancelDraft,
    cancelDraftConfirmOpen,
    cancelDraftMutation,
    confirmAction,
    confirmOpen,
    createEventMutation,
    editLoadFailed,
    editLoading,
    eventDraftValue,
    gameTitleItems,
    handleCancelDraftConfirmed,
    handleNavigateToMasters,
    hasSourceImagePanel,
    heldEvents,
    isNavigatingToMasters,
    isMutating,
    isOcrRunningBlocked,
    mapItems,
    matchDraftIdForImages,
    notice,
    onCreateEvent,
    onGameTitleChange,
    onIncidentChange,
    onPatchRoot,
    onPlayerChange,
    onPlayOrderChange,
    onPrimaryAction,
    pageDescription,
    pageTitle,
    refreshReviewStatus,
    refreshingReviewStatus,
    returnTo,
    seasonItems,
    selectedGameTitle,
    selectedHeldEvent,
    selectedMap,
    selectedSeason,
    setCancelDraftConfirmOpen,
    setEventDraftValue,
    setPreferredImageKind,
    sourceImageLoading,
    sourceImages,
    state,
    useSampleDrafts,
    validation,
    validationMessage,
    visibleErrorPathSet,
    workspaceLoading,
    workspaceData,
  } = controller;

  if (editLoading) {
    return (
      <MatchWorkspaceLoading
        description="保存済みの試合内容を取得しています。"
        title="試合編集を読み込み中"
      />
    );
  }

  if (workspaceLoading) {
    return (
      <MatchWorkspaceLoading
        description={
          mode === "review"
            ? "OCR結果と確定前の記録を取得しています。"
            : "試合条件と入力フォームを準備しています。"
        }
        title={mode === "review" ? "OCR結果を読み込み中" : "試合作成を準備中"}
      />
    );
  }

  if (editLoadFailed) {
    return (
      <PageFrame>
        <Notice tone="danger" title="試合が見つかりませんでした">
          一覧に戻って、対象の試合を選び直してください。
        </Notice>
        <LinkButton to="/matches" variant="secondary">
          試合一覧へ戻る
        </LinkButton>
      </PageFrame>
    );
  }

  return (
    <PageFrame className="gap-5" width="workspace">
      <LiveRegion message={notice || validationMessage} />

      <PageHeader
        description={
          <>
            {pageDescription}
            {useSampleDrafts ? (
              <span className="mt-2 block w-fit rounded-full border border-[var(--color-warning)]/65 bg-[var(--color-warning)]/18 px-3 py-1 text-sm font-semibold text-[var(--color-text-primary)]">
                サンプルの読み取り結果で表示中
              </span>
            ) : null}
          </>
        }
        eyebrow="試合記録"
        title={pageTitle}
        actions={
          <>
            {canCancelDraft ? (
              <AlertDialog
                cancelLabel="キャンセル"
                confirmLabel={cancelDraftMutation.isPending ? "削除中…" : "削除する"}
                pending={cancelDraftMutation.isPending}
                description="この確定前の記録を削除します。元に戻せません。"
                open={cancelDraftConfirmOpen}
                title="確定前の記録を削除しますか？"
                trigger={
                  <Button
                    disabled={isMutating}
                    variant="danger"
                    onClick={() => setCancelDraftConfirmOpen(true)}
                  >
                    {cancelDraftMutation.isPending ? "削除中…" : "確定前の記録を削除"}
                  </Button>
                }
                onConfirm={handleCancelDraftConfirmed}
                onOpenChange={setCancelDraftConfirmOpen}
              />
            ) : null}
            {(mode === "review" || mode === "create") && returnTo ? (
              <Button
                pending={isNavigatingToMasters}
                pendingLabel="移動中…"
                variant="secondary"
                onClick={handleNavigateToMasters}
              >
                設定管理へ
              </Button>
            ) : null}
          </>
        }
      />

      {baseErrors.map((error) => (
        <Notice key={`${error.status}-${error.detail}`} tone="danger" title={error.title}>
          {error.detail}
        </Notice>
      ))}

      {isOcrRunningBlocked ? (
        <Card className="mt-5">
          <h2 className="text-xl font-semibold text-[var(--color-text-primary)]">
            読み取り中は編集できません
          </h2>
          <p className="mt-2 text-sm text-pretty text-[var(--color-text-secondary)]">
            読み取りが終わるまで結果確認は開けません。完了後、試合一覧の「確認待ち」から開きます。
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button
              disabled={refreshingReviewStatus}
              pending={refreshingReviewStatus}
              pendingLabel="更新中…"
              variant="secondary"
              onClick={refreshReviewStatus}
            >
              状態を再確認
            </Button>
            <Link
              className="text-sm font-semibold text-[var(--color-action)] hover:underline"
              to="/matches"
            >
              試合一覧へ戻る
            </Link>
          </div>
        </Card>
      ) : (
        <>
          <MatchSetupSection
            createEventPending={createEventMutation.isPending}
            errorPathSet={visibleErrorPathSet}
            eventDraftValue={eventDraftValue}
            gameTitleItems={gameTitleItems}
            heldEvents={heldEvents}
            mapItems={mapItems}
            seasonItems={seasonItems}
            values={state.values}
            onCreateEvent={onCreateEvent}
            onEventDraftChange={setEventDraftValue}
            onGameTitleChange={onGameTitleChange}
            onPatchRoot={onPatchRoot}
          />

          {workspaceData?.warnings.length ? (
            <Card className="mt-4 border-[var(--color-warning)]/65 bg-[var(--color-warning)]/18">
              <ul className="list-disc pl-5 text-sm text-[var(--color-text-primary)]">
                {workspaceData.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </Card>
          ) : null}

          <div
            className={cn(
              "mt-4 grid gap-4",
              hasSourceImagePanel
                ? "xl:grid-cols-[minmax(0,1fr)_24rem] 2xl:grid-cols-[minmax(0,1fr)_28rem]"
                : "",
            )}
          >
            <Card className="p-4">
              <ScoreGrid
                errorPathSet={visibleErrorPathSet}
                lastSyncedPlayerIndex={state.lastSyncedPlayerIndex}
                originalPlayers={workspaceData?.originalPlayers}
                players={state.values.players}
                onIncidentChange={onIncidentChange}
                onPlayerChange={onPlayerChange}
                onPlayOrderChange={onPlayOrderChange}
                onPreferImageKindChange={setPreferredImageKind}
                onRequestSubmitFocus={onRequestSubmitFocus}
              />
            </Card>

            {hasSourceImagePanel && matchDraftIdForImages ? (
              <SourceImagePanel
                loading={sourceImageLoading}
                matchDraftId={matchDraftIdForImages}
                preferredKind={controller.preferredImageKind}
                sourceImages={sourceImages}
              />
            ) : null}
          </div>

          {validationMessage ? (
            <Card className="mt-4 border-[var(--color-warning)]/65 bg-[var(--color-warning)]/18">
              {validationMessage}
            </Card>
          ) : null}

          <MatchFormActions
            actionLabel={mode === "edit" ? "保存" : "確定前の確認へ進む"}
            disabled={workspaceLoading}
            message={
              validation.success
                ? "確定前の確認へ進めます"
                : (validation.firstMessage ?? "入力内容に不足があります")
            }
            pending={isMutating}
            primaryActionRef={primaryActionRef}
            onPrimaryAction={onPrimaryAction}
          />
        </>
      )}

      {confirmOpen ? (
        <MatchConfirmDialog
          gameTitleName={selectedGameTitle?.name}
          heldEvent={selectedHeldEvent}
          mapName={selectedMap?.name}
          seasonName={selectedSeason?.name}
          validationMessage={validationMessage}
          values={state.values}
          onCancel={controller.closeConfirm}
          confirmAction={confirmAction}
        />
      ) : null}
    </PageFrame>
  );
}
