import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import {
  useActionState,
  useEffect,
  useMemo,
  useOptimistic,
  useState,
  useTransition,
} from "react";
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
  const [, startReturnTransition] = useTransition();
  const navigateWithTransition = (to: string) => {
    startReturnTransition(() => {
      navigate(to);
    });
  };
  const [searchParams] = useSearchParams();

  const rawReturnTo = searchParams.get("returnTo");
  const returnTo = sanitizeReturnTo(rawReturnTo);
  const hasInvalidReturnTo = Boolean(rawReturnTo && !returnTo);
  const handoffId = searchParams.get("handoffId");
  const handoffStatus = returnTo
    ? inspectMasterHandoff({ expectedReturnTo: returnTo, handoffId }).status
    : "missing";

  const [selectedGameTitleId, setSelectedGameTitleId] = useState("");

  const gameTitlesQuery = useSuspenseQuery({
    queryKey: masterQueryKeys.gameTitles(authScope),
    queryFn: fetchGameTitles,
  });

  const mapMastersQuery = useQuery({
    queryKey: masterQueryKeys.mapMasters(authScope, selectedGameTitleId),
    queryFn: () => fetchMapMasters(selectedGameTitleId),
    enabled: Boolean(selectedGameTitleId),
  });

  const seasonMastersQuery = useQuery({
    queryKey: masterQueryKeys.seasonMasters(authScope, selectedGameTitleId),
    queryFn: () => fetchSeasonMasters(selectedGameTitleId),
    enabled: Boolean(selectedGameTitleId),
  });

  const incidentMastersQuery = useSuspenseQuery({
    queryKey: masterQueryKeys.incidentMasters(authScope),
    queryFn: fetchIncidentMasters,
  });

  const gameTitles = useMemo(() => gameTitlesQuery.data ?? [], [gameTitlesQuery.data]);
  const mapMasters = useMemo(() => mapMastersQuery.data ?? [], [mapMastersQuery.data]);
  const seasonMasters = useMemo(() => seasonMastersQuery.data ?? [], [seasonMastersQuery.data]);

  type OptimisticGameTitle = (typeof gameTitles)[number] & { pending?: boolean };
  type OptimisticMap = (typeof mapMasters)[number] & { pending?: boolean };
  type OptimisticSeason = (typeof seasonMasters)[number] & { pending?: boolean };

  const [optimisticGameTitles, addOptimisticGameTitle] = useOptimistic<
    OptimisticGameTitle[],
    OptimisticGameTitle
  >(gameTitles, (state, item) => [...state, item]);

  const [optimisticMapMasters, addOptimisticMapMaster] = useOptimistic<
    OptimisticMap[],
    OptimisticMap
  >(mapMasters, (state, item) => [...state, item]);

  const [optimisticSeasonMasters, addOptimisticSeasonMaster] = useOptimistic<
    OptimisticSeason[],
    OptimisticSeason
  >(seasonMasters, (state, item) => [...state, item]);

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
        gameTitles: optimisticGameTitles,
        mapMasters: optimisticMapMasters,
        seasonMasters: optimisticSeasonMasters,
        selectedGameTitleId,
      }),
    [optimisticGameTitles, optimisticMapMasters, optimisticSeasonMasters, selectedGameTitleId],
  );

  type CreateState = { error?: string | undefined; version: number };
  const initialCreateState: CreateState = { version: 0 };

  const [gameTitleCreateState, gameTitleCreateAction, gameTitleCreatePending] = useActionState<
    CreateState,
    FormData
  >(async (prev, formData) => {
    const name = normalizeName(String(formData.get("name") ?? ""));
    if (!isNameValid(name)) {
      return { ...prev, error: "作品名を入力してください" };
    }
    const layoutFamily = normalizeLayoutFamily(String(formData.get("layoutFamily") ?? ""));
    const draftId = createGameTitleId(name);
    addOptimisticGameTitle({
      id: draftId,
      layoutFamily,
      name,
      displayOrder: optimisticGameTitles.length,
      createdAt: new Date().toISOString(),
      pending: true,
    });
    try {
      const created = await postGameTitle({
        id: draftId,
        layoutFamily,
        name,
      });
      setSelectedGameTitleId(created.id);
      await invalidateMasterResourceCaches(
        queryClient,
        masterQueryKeys.gameTitles(authScope),
        "game-titles",
      );
      return { error: undefined, version: prev.version + 1 };
    } catch (error) {
      return { ...prev, error: errorMessage(error) ?? "作品の追加に失敗しました" };
    }
  }, initialCreateState);

  const [mapCreateState, mapCreateAction, mapCreatePending] = useActionState<CreateState, FormData>(
    async (prev, formData) => {
      const name = normalizeName(String(formData.get("name") ?? ""));
      if (!isNameValid(name) || !viewModel.selectedGameTitleId) {
        return { ...prev, error: "マップ名を入力してください" };
      }
      const draftId = createMapMasterId(name);
      addOptimisticMapMaster({
        id: draftId,
        gameTitleId: viewModel.selectedGameTitleId,
        name,
        displayOrder: viewModel.selectedMapMasters.length,
        createdAt: new Date().toISOString(),
        pending: true,
      });
      try {
        await postMapMaster({
          id: draftId,
          gameTitleId: viewModel.selectedGameTitleId,
          name,
        });
        await invalidateMasterResourceCaches(
          queryClient,
          masterQueryKeys.mapMasters(authScope, viewModel.selectedGameTitleId),
          "map-masters",
        );
        return { error: undefined, version: prev.version + 1 };
      } catch (error) {
        return { ...prev, error: errorMessage(error) ?? "マップの追加に失敗しました" };
      }
    },
    initialCreateState,
  );

  const [seasonCreateState, seasonCreateAction, seasonCreatePending] = useActionState<
    CreateState,
    FormData
  >(async (prev, formData) => {
    const name = normalizeName(String(formData.get("name") ?? ""));
    if (!isNameValid(name) || !viewModel.selectedGameTitleId) {
      return { ...prev, error: "シーズン名を入力してください" };
    }
    const draftId = createSeasonMasterId(name);
    addOptimisticSeasonMaster({
      id: draftId,
      gameTitleId: viewModel.selectedGameTitleId,
      name,
      displayOrder: viewModel.selectedSeasonMasters.length,
      createdAt: new Date().toISOString(),
      pending: true,
    });
    try {
      await postSeasonMaster({
        id: draftId,
        gameTitleId: viewModel.selectedGameTitleId,
        name,
      });
      await invalidateMasterResourceCaches(
        queryClient,
        masterQueryKeys.seasonMasters(authScope, viewModel.selectedGameTitleId),
        "season-masters",
      );
      return { error: undefined, version: prev.version + 1 };
    } catch (error) {
      return { ...prev, error: errorMessage(error) ?? "シーズンの追加に失敗しました" };
    }
  }, initialCreateState);

  const hasPendingMutation =
    gameTitleCreatePending || mapCreatePending || seasonCreatePending;

  const returnDestination =
    returnTo && handoffStatus === "available" && handoffId
      ? appendHandoffIdToReturnTo(returnTo, handoffId)
      : returnTo;

  return (
    <PageFrame className={sectionClass}>
      <PageHeader
        eyebrow="Admin"
        title="マスタ管理"
        description="作品を起点に、マップとシーズンの関係を管理します。"
        actions={
          returnTo ? (
            <Button variant="secondary" onClick={() => navigateWithTransition(returnDestination ?? "/matches")}>
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
          onReturn={() => navigateWithTransition(returnDestination)}
        />
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

      <MasterRelationBoard
        gameTitles={optimisticGameTitles}
        selectedGameTitleId={viewModel.selectedGameTitleId}
        selectedGameTitleName={viewModel.selectedGameTitle?.name}
        onSelectGameTitle={setSelectedGameTitleId}
        gameTitleCreateAction={gameTitleCreateAction}
        gameTitleCreateError={gameTitleCreateState.error}
        gameTitleCreateFormKey={gameTitleCreateState.version}
        gameTitleDefaultLayoutFamily={normalizeLayoutFamily("")}
        mapMasters={viewModel.selectedMapMasters}
        mapCreateAction={mapCreateAction}
        mapCreateError={mapCreateState.error}
        mapCreateFormKey={mapCreateState.version}
        seasonMasters={viewModel.selectedSeasonMasters}
        seasonCreateAction={seasonCreateAction}
        seasonCreateError={seasonCreateState.error}
        seasonCreateFormKey={seasonCreateState.version}
        scopedDisabledReason={viewModel.scopedDisabledReason}
        incidentMasters={incidentMastersQuery.data}
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
