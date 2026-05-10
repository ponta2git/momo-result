import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useActionState, useEffect, useMemo, useReducer, useState, useTransition } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import {
  buildMasterRoute,
  createDraftReviewHandoffPayload,
  saveMasterHandoff,
} from "@/features/masters/masterReturnHandoff";
import { isCancelableDraftStatus, reviewStatusLabel } from "@/features/matches/draftStatus";
import { MatchConfirmDialog } from "@/features/matches/workspace/MatchConfirmDialog";
import { MatchFormActions } from "@/features/matches/workspace/MatchFormActions";
import {
  createMatchFormReducerState,
  matchFormReducer,
} from "@/features/matches/workspace/matchFormReducer";
import { toConfirmMatchRequest } from "@/features/matches/workspace/matchFormToRequest";
import { createEmptyMatchForm } from "@/features/matches/workspace/matchFormTypes";
import type {
  MatchWorkspaceInitialData,
  WorkspaceMode,
} from "@/features/matches/workspace/matchFormTypes";
import { validateMatchForm } from "@/features/matches/workspace/matchFormValidation";
import { MatchSetupSection } from "@/features/matches/workspace/MatchSetupSection";
import { ScoreGrid } from "@/features/matches/workspace/scoreGrid/ScoreGrid";
import { SourceImagePanel } from "@/features/matches/workspace/sourceImages/SourceImagePanel";
import { toSourceImageDescriptor } from "@/features/matches/workspace/sourceImages/sourceImageTypes";
import type { SourceImageKind } from "@/features/matches/workspace/sourceImages/sourceImageTypes";
import { useMasterHandoffRestore } from "@/features/matches/workspace/useMasterHandoffRestore";
import { useMatchWorkspaceInit } from "@/features/matches/workspace/useMatchWorkspaceInit";
import { useMatchWorkspaceMutations } from "@/features/matches/workspace/useMatchWorkspaceMutations";
import { useMatchWorkspaceQueries } from "@/features/matches/workspace/useMatchWorkspaceQueries";
import {
  currentLocalIsoMinute,
  toIsoFromLocal,
} from "@/features/matches/workspace/workspaceDerivations";
import { createHeldEvent } from "@/shared/api/heldEvents";
import type { HeldEventListResponse, HeldEventResponse } from "@/shared/api/heldEvents";
import { formatApiError } from "@/shared/api/problemDetails";
import { isInitialQueryLoading, shouldShowBlockingQueryError } from "@/shared/api/queryErrorState";
import { heldEventKeys } from "@/shared/api/queryKeys";
import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import { AlertDialog } from "@/shared/ui/feedback/Dialog";
import { LiveRegion } from "@/shared/ui/feedback/LiveRegion";
import { Notice } from "@/shared/ui/feedback/Notice";
import { showToast } from "@/shared/ui/feedback/Toast";
import { Card } from "@/shared/ui/layout/Card";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { PageHeader } from "@/shared/ui/layout/PageHeader";

function upsertHeldEventList(
  current: HeldEventListResponse | undefined,
  event: HeldEventResponse,
): HeldEventListResponse {
  const existingItems = current?.items ?? [];
  const withoutDuplicate = existingItems.filter((item) => item.id !== event.id);
  return {
    items: [event, ...withoutDuplicate].toSorted(
      (left, right) =>
        new Date(right.heldAt).getTime() - new Date(left.heldAt).getTime() ||
        right.id.localeCompare(left.id),
    ),
  };
}

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
  const queryClient = useQueryClient();
  const [, startMastersTransition] = useTransition();
  const [searchParams] = useSearchParams();

  const [notice, setNotice] = useState("");
  const [validationMessage, setValidationMessage] = useState("");
  const [showValidationErrors, setShowValidationErrors] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cancelDraftConfirmOpen, setCancelDraftConfirmOpen] = useState(false);
  const [eventDraftValue, setEventDraftValue] = useState<string>(currentLocalIsoMinute);
  const [workspaceData, setWorkspaceData] = useState<MatchWorkspaceInitialData | null>(null);
  const [preferredImageKind, setPreferredImageKind] = useState<SourceImageKind>("total_assets");
  const notify = (message: string, tone: "info" | "success" | "warning" = "info") => {
    setNotice(message);
    showToast({ title: message, tone });
  };

  const [state, dispatch] = useReducer(
    matchFormReducer,
    createMatchFormReducerState(createEmptyMatchForm(new Date().toISOString())),
  );

  const useSampleDrafts = mode === "review" && searchParams.get("sample") === "1";
  const hasHandoff = searchParams.has("handoffId");

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
    mutationFn: (request: Parameters<typeof createHeldEvent>[0]) => createHeldEvent(request),
    onSuccess: (event) => {
      queryClient.setQueryData<HeldEventListResponse>(heldEventKeys.scope("workspace"), (current) =>
        upsertHeldEventList(current, event),
      );
      void queryClient.invalidateQueries({ queryKey: heldEventKeys.all() });
      dispatch({
        patch: {
          heldEventId: event.id,
          matchNoInEvent: event.matchCount + 1,
          playedAt: event.heldAt,
        },
        type: "patch_root",
      });
      notify(
        `開催履歴（${new Date(event.heldAt).toLocaleString()}）を作成して選択しました。`,
        "success",
      );
    },
    onError: (error) => {
      setValidationMessage(formatApiError(error, "開催履歴の作成に失敗しました"));
    },
  });

  const { cancelDraftMutation, confirmMutation, isMutating, updateMutation } =
    useMatchWorkspaceMutations({
      matchId,
      onConfirmSuccess: () => setConfirmOpen(false),
      onError: setValidationMessage,
    });

  const [, confirmAction] = useActionState<null, FormData>(async () => {
    await confirmMutation.mutateAsync(toConfirmMatchRequest(state.values));
    return null;
  }, null);

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
      notify("マスタ管理から戻ったため、入力内容を復元しました。", "success");
    },
    onRestoreFailed: () => {
      notify("マスタ管理から戻りましたが、入力内容を復元できませんでした。", "warning");
    },
    searchParams,
  });

  const validation = validateMatchForm(state.values);
  const emptyErrorPathSet = useMemo(() => new Set<string>(), []);
  const visibleErrorPathSet =
    showValidationErrors || mode !== "create" ? validation.pathSet : emptyErrorPathSet;
  const heldEvents = useMemo(
    () => heldEventsQuery.data?.items ?? [],
    [heldEventsQuery.data?.items],
  );
  const gameTitleItems = gameTitlesQuery.data?.items ?? [];
  const mapItems = mapMastersQuery.data?.items ?? [];
  const seasonItems = seasonMastersQuery.data?.items ?? [];
  const selectedHeldEvent = heldEvents.find((event) => event.id === state.values.heldEventId);
  const selectedGameTitle = gameTitleItems.find((item) => item.id === state.values.gameTitleId);
  const selectedMap = mapItems.find((item) => item.id === state.values.mapMasterId);
  const selectedSeason = seasonItems.find((item) => item.id === state.values.seasonMasterId);
  const matchDraftIdForImages = state.values.matchDraftId;
  const hasSourceImagePanel = mode !== "edit" && Boolean(matchDraftIdForImages);

  useEffect(() => {
    if (
      !isInitialized ||
      hasHandoff ||
      mode === "edit" ||
      state.values.heldEventId ||
      heldEvents.length === 0
    ) {
      return;
    }
    const latest = heldEvents.toSorted(
      (left, right) => new Date(right.heldAt).getTime() - new Date(left.heldAt).getTime(),
    )[0];
    if (!latest) {
      return;
    }
    dispatch({
      patch: {
        heldEventId: latest.id,
        matchNoInEvent: latest.matchCount + 1,
        playedAt: latest.heldAt,
      },
      type: "patch_root",
    });
  }, [hasHandoff, heldEvents, isInitialized, mode, state.values.heldEventId]);

  const canCancelDraft =
    mode !== "edit" &&
    !useSampleDrafts &&
    Boolean(draftDetailQuery.data) &&
    Boolean(state.values.matchDraftId) &&
    isCancelableDraftStatus(reviewStatus);

  const handleCancelDraftConfirmed = () => {
    const targetDraftId = state.values.matchDraftId;
    setCancelDraftConfirmOpen(false);
    if (!targetDraftId) {
      return;
    }
    setValidationMessage("");
    cancelDraftMutation.mutate(targetDraftId);
  };

  const handleNavigateToMasters = () => {
    if (!returnTo) {
      return;
    }
    const payload = createDraftReviewHandoffPayload({
      matchSessionId: matchSessionId ?? matchDraftId ?? "review",
      returnTo,
      values: state.values,
    });
    const handoffId = saveMasterHandoff(payload);
    startMastersTransition(() => {
      navigate(buildMasterRoute(returnTo, handoffId));
    });
  };

  const pageTitle =
    mode === "review" ? "OCR下書き確認" : mode === "edit" ? "試合を編集" : "試合の新規作成";
  const pageDescription =
    mode === "edit"
      ? "確定済みの試合記録を編集します。保存後は一覧と出力に反映されます。"
      : mode === "review"
        ? `OCR結果を確認して、開催履歴と4人分の結果を確定します。ステータス: ${reviewStatusLabel(reviewStatus)}`
        : "開催履歴と4人分の結果を入力して、確定前チェックへ進みます。";

  if (mode === "edit" && isInitialQueryLoading(matchDetailQuery)) {
    return (
      <PageFrame>
        <p className="text-[var(--color-text-secondary)]">読み込み中...</p>
      </PageFrame>
    );
  }

  if (mode === "edit" && shouldShowBlockingQueryError(matchDetailQuery)) {
    return (
      <PageFrame>
        <Notice tone="danger" title="試合が見つかりませんでした">
          一覧に戻って、対象の試合を選び直してください。
        </Notice>
        <Link to="/matches">
          <Button variant="secondary">試合一覧へ戻る</Button>
        </Link>
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
                開発用サンプル下書きで表示中
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
                confirmLabel={cancelDraftMutation.isPending ? "削除中..." : "削除する"}
                description="この確定前の下書きを削除します。元に戻せません。"
                open={cancelDraftConfirmOpen}
                title="下書きを削除しますか？"
                trigger={
                  <Button
                    disabled={isMutating}
                    variant="danger"
                    onClick={() => setCancelDraftConfirmOpen(true)}
                  >
                    {cancelDraftMutation.isPending ? "削除中..." : "下書きを削除"}
                  </Button>
                }
                onConfirm={handleCancelDraftConfirmed}
                onOpenChange={setCancelDraftConfirmOpen}
              />
            ) : null}
            {mode === "review" && returnTo ? (
              <Button variant="secondary" onClick={handleNavigateToMasters}>
                マスタ管理へ
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
            errorPathSet={visibleErrorPathSet}
            eventDraftValue={eventDraftValue}
            gameTitleItems={gameTitleItems}
            heldEvents={heldEventsQuery.data?.items ?? []}
            mapItems={mapItems}
            seasonItems={seasonItems}
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

            {hasSourceImagePanel && matchDraftIdForImages ? (
              <SourceImagePanel
                loading={sourceImageQuery.isLoading}
                preferredKind={preferredImageKind}
                sourceImages={(sourceImageQuery.data?.items ?? []).map((item) =>
                  toSourceImageDescriptor(matchDraftIdForImages, item),
                )}
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
            disabled={false}
            message={
              validation.success
                ? "確定前チェックへ進めます"
                : (validation.firstMessage ?? "入力内容を確認してください")
            }
            pending={isMutating}
            onPrimaryAction={() => {
              const nextValidation = validateMatchForm(state.values);
              if (!nextValidation.success) {
                setShowValidationErrors(true);
                setValidationMessage(nextValidation.firstMessage ?? "入力内容を確認してください");
                return;
              }
              setShowValidationErrors(false);
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
          gameTitleName={selectedGameTitle?.name}
          heldEvent={selectedHeldEvent}
          mapName={selectedMap?.name}
          seasonName={selectedSeason?.name}
          values={state.values}
          onCancel={() => setConfirmOpen(false)}
          confirmAction={confirmAction}
        />
      ) : null}
    </PageFrame>
  );
}
