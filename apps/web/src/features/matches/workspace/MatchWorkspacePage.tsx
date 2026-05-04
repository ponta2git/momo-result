import { useMutation } from "@tanstack/react-query";
import { useEffect, useReducer, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { createHeldEvent } from "@/features/draftReview/api";
import {
  buildMasterRoute,
  createDraftReviewHandoffPayload,
  saveMasterHandoff,
} from "@/features/masters/masterReturnHandoff";
import { MatchConfirmDialog } from "@/features/matches/workspace/MatchConfirmDialog";
import { MatchFormActions } from "@/features/matches/workspace/MatchFormActions";
import { toIsoFromLocal } from "@/features/matches/workspace/workspaceDerivations";
import { useMasterHandoffRestore } from "@/features/matches/workspace/useMasterHandoffRestore";
import { useMatchWorkspaceInit } from "@/features/matches/workspace/useMatchWorkspaceInit";
import { useMatchWorkspaceMutations } from "@/features/matches/workspace/useMatchWorkspaceMutations";
import { useMatchWorkspaceQueries } from "@/features/matches/workspace/useMatchWorkspaceQueries";
import {
  createMatchFormReducerState,
  matchFormReducer,
} from "@/features/matches/workspace/matchFormReducer";
import { toConfirmMatchRequest } from "@/features/matches/workspace/matchFormToRequest";
import { createEmptyMatchForm } from "@/features/matches/workspace/matchFormTypes";
import {
  isCancelableDraftStatus,
  reviewStatusLabel,
} from "@/features/matches/draftStatus";
import type {
  MatchWorkspaceInitialData,
  WorkspaceMode,
} from "@/features/matches/workspace/matchFormTypes";
import { validateMatchForm } from "@/features/matches/workspace/matchFormValidation";
import { MatchSetupSection } from "@/features/matches/workspace/MatchSetupSection";
import { ScoreGrid } from "@/features/matches/workspace/scoreGrid/ScoreGrid";
import { SourceImagePanel } from "@/features/matches/workspace/sourceImages/SourceImagePanel";
import type { SourceImageKind } from "@/features/matches/workspace/sourceImages/sourceImageTypes";
import {
  isInitialQueryLoading,
  shouldShowBlockingQueryError,
} from "@/shared/api/queryErrorState";
import { assertDefined } from "@/shared/lib/invariant";
import { Button } from "@/shared/ui/actions/Button";
import { LiveRegion } from "@/shared/ui/feedback/LiveRegion";
import { Card } from "@/shared/ui/layout/Card";

const labelClass = "text-xs font-semibold text-[var(--color-text-secondary)]";

// reviewStatusLabel / isCancelableDraftStatus は features/matches/draftStatus.ts に集約
// 純関数（draftIdsFromParams 等）は ./workspaceDerivations.ts に集約

type MatchWorkspacePageProps = {
  matchDraftId?: string;
  matchId?: string;
  matchSessionId?: string;
  mode: WorkspaceMode;
};

export function MatchWorkspacePage({
  matchDraftId,
  matchId,
  matchSessionId,
  mode,
}: MatchWorkspacePageProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [notice, setNotice] = useState("");
  const [validationMessage, setValidationMessage] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [eventDraftValue, setEventDraftValue] = useState("");
  const [workspaceData, setWorkspaceData] = useState<MatchWorkspaceInitialData | null>(null);
  const [preferredImageKind, setPreferredImageKind] = useState<SourceImageKind>("total_assets");

  const [state, dispatch] = useReducer(
    matchFormReducer,
    createMatchFormReducerState(createEmptyMatchForm(new Date().toISOString())),
  );

  const useSampleDrafts = mode === "review" && searchParams.get("sample") === "1";

  const {
    derived: { baseErrors, isOcrRunningBlocked, refreshingReviewStatus, reviewStatus },
    draftDetailQuery,
    gameTitlesQuery,
    heldEventsQuery,
    mapMastersQuery,
    matchDetailQuery,
    ocrDraftsQuery,
    reviewDraftIdList,
    reviewDraftIds,
    seasonMastersQuery,
    sourceImageQuery,
  } = useMatchWorkspaceQueries({
    gameTitleId: state.values.gameTitleId,
    matchDraftId,
    matchDraftSourceImagesId: state.values.matchDraftId,
    matchId,
    mode,
    searchParams,
    useSampleDrafts,
  });

  const createEventMutation = useMutation({
    mutationFn: createHeldEvent,
    onSuccess: (event) => {
      dispatch({
        patch: {
          heldEventId: event.id,
          matchNoInEvent: event.matchCount + 1,
          playedAt: event.heldAt,
        },
        type: "patch_root",
      });
      setNotice(`開催履歴（${new Date(event.heldAt).toLocaleString()}）を作成して選択しました。`);
    },
  });

  const { cancelDraftMutation, confirmMutation, isMutating, updateMutation } =
    useMatchWorkspaceMutations({
      matchId,
      onConfirmSuccess: () => setConfirmOpen(false),
      onError: setValidationMessage,
    });

  useEffect(() => {
    if (eventDraftValue) {
      return;
    }

    const now = new Date();
    const offsetMs = now.getTimezoneOffset() * 60_000;
    setEventDraftValue(new Date(now.getTime() - offsetMs).toISOString().slice(0, 16));
  }, [eventDraftValue]);

  useEffect(() => {
    if (notice === "") {
      return;
    }
    const timer = window.setTimeout(() => setNotice(""), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const { isInitialized } = useMatchWorkspaceInit({
    draftDetail: draftDetailQuery.data ?? undefined,
    draftDetailLoading: draftDetailQuery.isLoading,
    emptyFormFactory: () => createEmptyMatchForm(new Date().toISOString()),
    matchDetail: matchDetailQuery.data ?? undefined,
    matchDraftId,
    matchId,
    mode,
    ocrDrafts: ocrDraftsQuery.data ?? undefined,
    ocrDraftsError: ocrDraftsQuery.isError,
    onInitialize: (values, workspaceInitial) => {
      dispatch({ payload: values, type: "replace" });
      setWorkspaceData(workspaceInitial);
    },
    reviewDraftIdList,
    reviewDraftIds,
    useSampleDrafts,
  });

  const { returnTo } = useMasterHandoffRestore({
    isInitialized,
    matchSessionId,
    mode,
    onRestore: (payload) => {
      dispatch({
        payload: {
          ...state.values,
          ...payload.values,
          ...(state.values.matchDraftId ? { matchDraftId: state.values.matchDraftId } : {}),
        },
        type: "replace",
      });
      setNotice("マスタ管理から戻ったため、入力内容を復元しました。");
    },
    onRestoreFailed: () => {
      setNotice("マスタ管理から戻りましたが、入力内容を復元できませんでした。");
    },
    searchParams,
  });

  const validation = validateMatchForm(state.values);
  const selectedHeldEvent = (heldEventsQuery.data?.items ?? []).find(
    (event) => event.id === state.values.heldEventId,
  );

  const canCancelDraft =
    mode !== "edit" &&
    !useSampleDrafts &&
    Boolean(draftDetailQuery.data) &&
    Boolean(state.values.matchDraftId) &&
    isCancelableDraftStatus(reviewStatus);

  if (mode === "edit" && isInitialQueryLoading(matchDetailQuery)) {
    return <p className="p-8 text-[var(--color-text-secondary)]">読み込み中...</p>;
  }

  if (mode === "edit" && shouldShowBlockingQueryError(matchDetailQuery)) {
    return (
      <div className="p-8">
        <p className="text-[var(--color-danger)]">試合が見つかりませんでした</p>
        <Link className="text-[var(--color-action)] hover:underline" to="/matches">
          一覧に戻る
        </Link>
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-[1440px] px-4 py-8 sm:px-6 lg:px-8">
      <LiveRegion message={notice || validationMessage} />

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className={labelClass}>
            {mode === "review"
              ? "Match Review Workspace"
              : mode === "edit"
                ? "Match Edit Workspace"
                : "Match Create Workspace"}
          </p>
          <h1 className="mt-1 text-3xl font-semibold text-balance text-[var(--color-text-primary)]">
            {mode === "review"
              ? "OCR下書き確認"
              : mode === "edit"
                ? "試合を編集"
                : "試合の新規作成"}
          </h1>
          <p className="mt-2 text-sm text-pretty text-[var(--color-text-secondary)]">
            1試合フォームを共通基盤で処理します。ステータス: {reviewStatusLabel(reviewStatus)}
          </p>
          {useSampleDrafts ? (
            <p className="mt-2 inline-flex rounded-full border border-[var(--color-warning)]/65 bg-[var(--color-warning)]/18 px-3 py-1 text-sm font-semibold text-[var(--color-text-primary)]">
              開発用サンプル下書きで表示中
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            className="text-sm font-semibold text-[var(--color-action)] hover:underline"
            to="/matches"
          >
            ← 試合一覧へ戻る
          </Link>
          {canCancelDraft ? (
            <Button
              disabled={isMutating}
              variant="danger"
              onClick={() => {
                const targetDraftId = state.values.matchDraftId;
                if (!targetDraftId) {
                  return;
                }
                const confirmed = window.confirm(
                  "この確定前の下書きを削除します。元に戻せません。よろしいですか？",
                );
                if (!confirmed) {
                  return;
                }
                setValidationMessage("");
                cancelDraftMutation.mutate(targetDraftId);
              }}
            >
              {cancelDraftMutation.isPending ? "削除中..." : "下書きを削除"}
            </Button>
          ) : null}
          {mode === "review" && returnTo ? (
            <Button
              variant="secondary"
              onClick={() => {
                const payload = createDraftReviewHandoffPayload({
                  matchSessionId: matchSessionId ?? matchDraftId ?? "review",
                  returnTo,
                  values: {
                    draftIds: {
                      incidentLog: state.values.draftIds.incidentLog,
                      revenue: state.values.draftIds.revenue,
                      totalAssets: state.values.draftIds.totalAssets,
                    },
                    gameTitleId: state.values.gameTitleId,
                    heldEventId: state.values.heldEventId,
                    mapMasterId: state.values.mapMasterId,
                    matchNoInEvent: state.values.matchNoInEvent,
                    ownerMemberId: state.values.ownerMemberId,
                    playedAt: state.values.playedAt,
                    players: state.values.players.map((player) => ({
                      incidents: {
                        cardShop: player.incidents.cardShop,
                        cardStation: player.incidents.cardStation,
                        destination: player.incidents.destination,
                        minusStation: player.incidents.minusStation,
                        plusStation: player.incidents.plusStation,
                        suriNoGinji: player.incidents.suriNoGinji,
                      },
                      memberId: player.memberId,
                      playOrder: player.playOrder,
                      rank: player.rank,
                      revenueManYen: player.revenueManYen,
                      totalAssetsManYen: player.totalAssetsManYen,
                    })),
                    seasonMasterId: state.values.seasonMasterId,
                  },
                });
                const handoffId = saveMasterHandoff(payload);
                navigate(buildMasterRoute(returnTo, handoffId));
              }}
            >
              マスタ管理へ
            </Button>
          ) : null}
        </div>
      </header>

      {baseErrors.map((error) => (
        <div
          key={`${error.status}-${error.detail}`}
          className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-danger)]/50 bg-[var(--color-danger)]/10 p-4 text-[var(--color-text-primary)]"
          role="alert"
        >
          <strong>{error.title}</strong>
          <p className="mt-1 text-sm">{error.detail}</p>
        </div>
      ))}

      {notice ? (
        <div
          className="momo-safe-top momo-safe-right fixed z-[var(--z-toast)] max-w-sm rounded-[var(--radius-lg)] border border-[var(--color-warning)]/65 bg-[var(--color-surface)] p-3 text-sm text-[var(--color-text-primary)] shadow-sm"
          role="status"
        >
          <div className="flex items-start justify-between gap-2">
            <p>{notice}</p>
            <button
              className="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
              type="button"
              onClick={() => setNotice("")}
            >
              閉じる
            </button>
          </div>
        </div>
      ) : null}

      {isOcrRunningBlocked ? (
        <Card className="mt-5">
          <h2 className="text-xl font-semibold text-[var(--color-text-primary)]">
            OCR中のため編集できません
          </h2>
          <p className="mt-2 text-sm text-pretty text-[var(--color-text-secondary)]">
            OCRジョブが完了するまで結果確認画面には入れません。完了後に試合一覧の「確定前」から再度開いてください。
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button
              disabled={refreshingReviewStatus}
              variant="secondary"
              onClick={async () => {
                await Promise.all([draftDetailQuery.refetch(), ocrDraftsQuery.refetch()]);
              }}
            >
              {refreshingReviewStatus ? "更新中..." : "状態を更新"}
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
            eventDraftValue={eventDraftValue}
            gameTitleItems={gameTitlesQuery.data?.items}
            heldEvents={heldEventsQuery.data?.items ?? []}
            mapItems={mapMastersQuery.data?.items}
            seasonItems={seasonMastersQuery.data?.items}
            values={state.values}
            onCreateEvent={() =>
              createEventMutation.mutate({
                heldAt: toIsoFromLocal(eventDraftValue),
              })
            }
            onEventDraftChange={setEventDraftValue}
            onGameTitleChange={(gameTitleId) => {
              dispatch({
                patch: {
                  gameTitleId,
                  mapMasterId: "",
                  seasonMasterId: "",
                },
                type: "patch_root",
              });
            }}
            onPatchRoot={(patch) => dispatch({ patch, type: "patch_root" })}
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

          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_26rem]">
            <Card className="p-4">
              {mode === "review" ? (
                <details className="mb-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3">
                  <summary className="cursor-pointer text-sm font-semibold text-[var(--color-text-primary)]">
                    OCR読み取り状況を確認
                  </summary>
                  <p className="mt-2 text-xs text-[var(--color-text-secondary)]">
                    緑=高信頼OCR / 黄=要確認 / 金=手修正
                  </p>
                </details>
              ) : null}
              <ScoreGrid
                errorPathSet={validation.pathSet}
                incidentByPlayOrder={workspaceData?.incidentByPlayOrder}
                lastSyncedPlayerIndex={state.lastSyncedPlayerIndex}
                originalPlayers={workspaceData?.originalPlayers}
                players={state.values.players}
                onIncidentChange={(index, key, value) =>
                  dispatch({ index, key, type: "patch_incident", value })
                }
                onPlayerChange={(index, patch) => dispatch({ index, patch, type: "patch_player" })}
                onPlayOrderChange={(index, playOrder) =>
                  dispatch({
                    index,
                    playOrder,
                    type: "set_play_order",
                    ...(workspaceData?.incidentByPlayOrder
                      ? { incidentByPlayOrder: workspaceData.incidentByPlayOrder }
                      : {}),
                  })
                }
                onPreferImageKindChange={setPreferredImageKind}
                onRequestSubmitFocus={() => {
                  const action = document.getElementById("workspace-primary-action");
                  action?.focus();
                }}
              />
            </Card>

            {mode !== "edit" && state.values.matchDraftId ? (
              <SourceImagePanel
                loading={sourceImageQuery.isLoading}
                preferredKind={preferredImageKind}
                sourceImages={(sourceImageQuery.data?.items ?? []).map((item) => {
                  const matchDraftIdForImages = state.values.matchDraftId;
                  assertDefined(matchDraftIdForImages, "matchDraftId");
                  return Object.assign(
                    {
                      createdAt: item.createdAt,
                      imageUrl:
                        item.imageUrl ||
                        `/api/match-drafts/${encodeURIComponent(matchDraftIdForImages)}/source-images/${encodeURIComponent(item.kind)}`,
                      kind: item.kind as SourceImageKind,
                    },
                    item.contentType ? { contentType: item.contentType } : {},
                  );
                })}
              />
            ) : null}
          </div>

          {validationMessage ? (
            <Card className="mt-4 border-[var(--color-warning)]/65 bg-[var(--color-warning)]/18">
              {validationMessage}
            </Card>
          ) : null}

          <MatchFormActions
            actionLabel={mode === "edit" ? "保存" : "確定前チェックへ進む"}
            disabled={!validation.success}
            message={
              validation.success
                ? "確定前チェックへ進めます"
                : (validation.firstMessage ?? "入力内容を確認してください")
            }
            pending={isMutating}
            onPrimaryAction={() => {
              const nextValidation = validateMatchForm(state.values);
              if (!nextValidation.success) {
                setValidationMessage(nextValidation.firstMessage ?? "入力内容を確認してください");
                return;
              }
              setValidationMessage("");
              if (mode === "edit") {
                updateMutation.mutate(state.values);
                return;
              }
              setConfirmOpen(true);
            }}
          />
        </>
      )}

      {confirmOpen ? (
        <MatchConfirmDialog
          heldEvent={selectedHeldEvent}
          pending={confirmMutation.isPending}
          values={state.values}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => confirmMutation.mutate(toConfirmMatchRequest(state.values))}
        />
      ) : null}
    </main>
  );
}
