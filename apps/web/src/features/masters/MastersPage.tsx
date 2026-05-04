import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import {
  fetchGameTitles,
  fetchIncidentMasters,
  fetchMapMasters,
  fetchSeasonMasters,
  masterQueryKeys,
  postGameTitle,
  postMapMaster,
  postSeasonMaster,
} from "@/features/masters/masterApi";
import {
  createGameTitleId,
  createMapMasterId,
  createSeasonMasterId,
} from "@/features/masters/masterId";
import { MasterRelationBoard } from "@/features/masters/MasterRelationBoard";
import {
  appendHandoffIdToReturnTo,
  inspectMasterHandoff,
  sanitizeReturnTo,
} from "@/features/masters/masterReturnHandoff";
import { MasterReturnNotice } from "@/features/masters/MasterReturnNotice";
import {
  isNameValid,
  normalizeLayoutFamily,
  normalizeName,
} from "@/features/masters/masterValidation";
import { buildMasterViewModel } from "@/features/masters/masterViewModel";
import { normalizeUnknownApiError } from "@/shared/api/problemDetails";
import { shouldShowQueryError } from "@/shared/api/queryErrorState";
import { useAuth } from "@/shared/auth/useAuth";
import { Button } from "@/shared/ui/actions/Button";
import { Notice } from "@/shared/ui/feedback/Notice";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { PageHeader } from "@/shared/ui/layout/PageHeader";

const sectionClass = "grid gap-4";

function errorMessage(error: unknown): string | undefined {
  if (!error) {
    return undefined;
  }
  const normalized = normalizeUnknownApiError(error);
  return normalized.detail || normalized.title;
}

async function invalidateMasterResourceCaches(
  queryClient: ReturnType<typeof useQueryClient>,
  adminQueryKey: readonly unknown[],
  resource: "game-titles" | "map-masters" | "season-masters",
) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: adminQueryKey }),
    queryClient.invalidateQueries({ queryKey: ["masters", resource] }),
    queryClient.invalidateQueries({ queryKey: [resource] }),
  ]);
}

export function MastersPage() {
  const auth = useAuth();
  const authScope = auth.auth?.memberId ?? "anonymous";
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const rawReturnTo = searchParams.get("returnTo");
  const returnTo = sanitizeReturnTo(rawReturnTo);
  const hasInvalidReturnTo = Boolean(rawReturnTo && !returnTo);
  const handoffId = searchParams.get("handoffId");
  const handoffStatus = returnTo
    ? inspectMasterHandoff({ expectedReturnTo: returnTo, handoffId }).status
    : "missing";

  const [selectedGameTitleId, setSelectedGameTitleId] = useState("");
  const [gameTitleDraft, setGameTitleDraft] = useState({
    layoutFamily: normalizeLayoutFamily(""),
    name: "",
  });
  const [mapDraftName, setMapDraftName] = useState("");
  const [seasonDraftName, setSeasonDraftName] = useState("");

  const gameTitlesQuery = useQuery({
    queryKey: masterQueryKeys.gameTitles(authScope),
    queryFn: fetchGameTitles,
    enabled: auth.isAuthenticated,
  });

  const mapMastersQuery = useQuery({
    queryKey: masterQueryKeys.mapMasters(authScope, selectedGameTitleId),
    queryFn: () => fetchMapMasters(selectedGameTitleId),
    enabled: auth.isAuthenticated && Boolean(selectedGameTitleId),
  });

  const seasonMastersQuery = useQuery({
    queryKey: masterQueryKeys.seasonMasters(authScope, selectedGameTitleId),
    queryFn: () => fetchSeasonMasters(selectedGameTitleId),
    enabled: auth.isAuthenticated && Boolean(selectedGameTitleId),
  });

  const incidentMastersQuery = useQuery({
    queryKey: masterQueryKeys.incidentMasters(authScope),
    queryFn: fetchIncidentMasters,
    enabled: auth.isAuthenticated,
  });

  const gameTitles = useMemo(() => gameTitlesQuery.data ?? [], [gameTitlesQuery.data]);
  const mapMasters = useMemo(() => mapMastersQuery.data ?? [], [mapMastersQuery.data]);
  const seasonMasters = useMemo(() => seasonMastersQuery.data ?? [], [seasonMastersQuery.data]);

  useEffect(() => {
    if (gameTitles.length === 0) {
      setSelectedGameTitleId("");
      return;
    }
    const exists = gameTitles.some((item) => item.id === selectedGameTitleId);
    if (!exists) {
      const first = gameTitles[0];
      if (first) {
        setSelectedGameTitleId(first.id);
      }
    }
  }, [gameTitles, selectedGameTitleId]);

  const viewModel = useMemo(
    () =>
      buildMasterViewModel({
        gameTitles,
        mapMasters,
        seasonMasters,
        selectedGameTitleId,
      }),
    [gameTitles, mapMasters, seasonMasters, selectedGameTitleId],
  );

  const createGameTitleMutation = useMutation({
    mutationFn: postGameTitle,
    onSuccess(created) {
      setSelectedGameTitleId(created.id);
      setGameTitleDraft({ layoutFamily: normalizeLayoutFamily(""), name: "" });
      void invalidateMasterResourceCaches(
        queryClient,
        masterQueryKeys.gameTitles(authScope),
        "game-titles",
      );
    },
  });

  const createMapMutation = useMutation({
    mutationFn: postMapMaster,
    onSuccess() {
      setMapDraftName("");
      void invalidateMasterResourceCaches(
        queryClient,
        masterQueryKeys.mapMasters(authScope, selectedGameTitleId),
        "map-masters",
      );
    },
  });

  const createSeasonMutation = useMutation({
    mutationFn: postSeasonMaster,
    onSuccess() {
      setSeasonDraftName("");
      void invalidateMasterResourceCaches(
        queryClient,
        masterQueryKeys.seasonMasters(authScope, selectedGameTitleId),
        "season-masters",
      );
    },
  });

  const hasPendingMutation =
    createGameTitleMutation.isPending ||
    createMapMutation.isPending ||
    createSeasonMutation.isPending;

  const returnDestination =
    returnTo && handoffStatus === "available" && handoffId
      ? appendHandoffIdToReturnTo(returnTo, handoffId)
      : returnTo;

  function handleCreateGameTitle() {
    const name = normalizeName(gameTitleDraft.name);
    if (!isNameValid(name)) {
      return;
    }
    createGameTitleMutation.mutate({
      id: createGameTitleId(name),
      layoutFamily: normalizeLayoutFamily(gameTitleDraft.layoutFamily),
      name,
    });
  }

  function handleCreateMap() {
    const name = normalizeName(mapDraftName);
    if (!isNameValid(name) || !viewModel.selectedGameTitleId) {
      return;
    }
    createMapMutation.mutate({
      id: createMapMasterId(name),
      gameTitleId: viewModel.selectedGameTitleId,
      name,
    });
  }

  function handleCreateSeason() {
    const name = normalizeName(seasonDraftName);
    if (!isNameValid(name) || !viewModel.selectedGameTitleId) {
      return;
    }
    createSeasonMutation.mutate({
      id: createSeasonMasterId(name),
      gameTitleId: viewModel.selectedGameTitleId,
      name,
    });
  }

  return (
    <PageFrame className={sectionClass}>
      <PageHeader
        eyebrow="Admin"
        title="マスタ管理"
        description="作品を起点に、マップとシーズンの関係を管理します。"
        actions={
          returnTo ? (
            <Button variant="secondary" onClick={() => navigate(returnDestination ?? "/matches")}>
              戻る
            </Button>
          ) : (
            <Link
              className="inline-flex min-h-10 items-center rounded-[var(--radius-sm)] border border-[var(--color-border)] px-4 py-2 text-sm font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-surface-subtle)]"
              to="/matches"
            >
              試合一覧へ
            </Link>
          )
        }
      />

      {auth.error ? (
        <Notice tone="danger" title={auth.error.title}>
          {auth.error.detail}
        </Notice>
      ) : null}

      {returnDestination ? (
        <MasterReturnNotice
          destination={returnDestination}
          handoffStatus={handoffStatus}
          disabled={hasPendingMutation}
          onReturn={() => navigate(returnDestination)}
        />
      ) : null}

      {auth.isAuthenticated && shouldShowQueryError(gameTitlesQuery) ? (
        <Notice tone="danger" title="作品マスタの読み込みに失敗しました">
          {errorMessage(gameTitlesQuery.error)}
        </Notice>
      ) : null}
      {auth.isAuthenticated && shouldShowQueryError(mapMastersQuery) ? (
        <Notice tone="danger" title="マップマスタの読み込みに失敗しました">
          {errorMessage(mapMastersQuery.error)}
        </Notice>
      ) : null}
      {auth.isAuthenticated && shouldShowQueryError(seasonMastersQuery) ? (
        <Notice tone="danger" title="シーズンマスタの読み込みに失敗しました">
          {errorMessage(seasonMastersQuery.error)}
        </Notice>
      ) : null}
      {auth.isAuthenticated && shouldShowQueryError(incidentMastersQuery) ? (
        <Notice tone="danger" title="事件簿マスタの読み込みに失敗しました">
          {errorMessage(incidentMastersQuery.error)}
        </Notice>
      ) : null}

      <MasterRelationBoard
        gameTitles={gameTitles}
        selectedGameTitleId={viewModel.selectedGameTitleId}
        selectedGameTitleName={viewModel.selectedGameTitle?.name}
        onSelectGameTitle={setSelectedGameTitleId}
        gameTitleCreateValue={gameTitleDraft}
        onChangeGameTitleCreateValue={(patch) =>
          setGameTitleDraft((current) => ({ ...current, ...patch }))
        }
        onCreateGameTitle={handleCreateGameTitle}
        gameTitleCreatePending={createGameTitleMutation.isPending}
        gameTitleCreateError={errorMessage(createGameTitleMutation.error)}
        mapMasters={viewModel.selectedMapMasters}
        mapCreateValue={mapDraftName}
        onChangeMapCreateValue={setMapDraftName}
        onCreateMap={handleCreateMap}
        mapCreatePending={createMapMutation.isPending}
        mapCreateError={errorMessage(createMapMutation.error)}
        seasonMasters={viewModel.selectedSeasonMasters}
        seasonCreateValue={seasonDraftName}
        onChangeSeasonCreateValue={setSeasonDraftName}
        onCreateSeason={handleCreateSeason}
        seasonCreatePending={createSeasonMutation.isPending}
        seasonCreateError={errorMessage(createSeasonMutation.error)}
        scopedDisabledReason={viewModel.scopedDisabledReason}
        incidentMasters={incidentMastersQuery.data ?? []}
      />

      {hasInvalidReturnTo ? (
        <Notice tone="warning" title="戻り先を確認できませんでした">
          戻り先パラメータが不正なため、試合一覧への導線だけを表示しています。
        </Notice>
      ) : null}

      {viewModel.shouldPromptGameTitleCreation ? (
        <Notice tone="info" title="最初に作品を追加してください">
          マップとシーズンは作品に紐づいて作成されます。
        </Notice>
      ) : null}
    </PageFrame>
  );
}
