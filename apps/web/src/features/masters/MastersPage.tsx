import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useActionState, useEffect, useMemo, useOptimistic, useState, useTransition } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { IncidentMasterPanel } from "@/features/masters/IncidentMasterPanel";
import {
  fetchGameTitles,
  fetchIncidentMasters,
  fetchMapMasters,
  fetchMemberAliases,
  fetchSeasonMasters,
  masterQueryKeys,
  patchGameTitle,
  patchMapMaster,
  patchMemberAlias,
  patchSeasonMaster,
  postGameTitle,
  postMapMaster,
  postMemberAlias,
  postSeasonMaster,
  removeGameTitle,
  removeMapMaster,
  removeMemberAlias,
  removeSeasonMaster,
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
import { MemberAliasPanel } from "@/features/masters/MemberAliasPanel";
import { formatApiError, normalizeUnknownApiError } from "@/shared/api/problemDetails";
import { shouldShowQueryError } from "@/shared/api/queryErrorState";
import { useAuth } from "@/shared/auth/useAuth";
import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import { Notice } from "@/shared/ui/feedback/Notice";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { PageHeader } from "@/shared/ui/layout/PageHeader";

const sectionClass = "grid gap-4";
const masterTabs = [
  { id: "catalog", label: "作品・マップ・シーズン" },
  { id: "aliases", label: "メンバー名寄せ" },
  { id: "incidents", label: "事件簿" },
] as const;
type MasterTabId = (typeof masterTabs)[number]["id"];

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
  const authScope = auth.auth?.accountId ?? "anonymous";
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
  const [activeTab, setActiveTab] = useState<MasterTabId>("catalog");
  const [operationError, setOperationError] = useState<string>();

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

  const memberAliasesQuery = useSuspenseQuery({
    queryKey: masterQueryKeys.memberAliases(authScope),
    queryFn: fetchMemberAliases,
  });

  const gameTitles = useMemo(() => gameTitlesQuery.data ?? [], [gameTitlesQuery.data]);
  const mapMasters = useMemo(() => mapMastersQuery.data ?? [], [mapMastersQuery.data]);
  const seasonMasters = useMemo(() => seasonMastersQuery.data ?? [], [seasonMastersQuery.data]);
  const memberAliases = useMemo(() => memberAliasesQuery.data ?? [], [memberAliasesQuery.data]);

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
      return { ...prev, error: formatApiError(error, "作品の追加に失敗しました") };
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
        return { ...prev, error: formatApiError(error, "マップの追加に失敗しました") };
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
      return { ...prev, error: formatApiError(error, "シーズンの追加に失敗しました") };
    }
  }, initialCreateState);

  const [aliasCreateState, aliasCreateAction, aliasCreatePending] = useActionState<
    CreateState,
    FormData
  >(async (prev, formData) => {
    const memberId = normalizeName(String(formData.get("memberId") ?? ""));
    const alias = normalizeName(String(formData.get("alias") ?? ""));
    if (!memberId || !alias) {
      return { ...prev, error: "プレーヤーと別名を入力してください" };
    }
    try {
      await postMemberAlias({ memberId, alias });
      await queryClient.invalidateQueries({ queryKey: masterQueryKeys.memberAliases(authScope) });
      return { error: undefined, version: prev.version + 1 };
    } catch (error) {
      return { ...prev, error: formatApiError(error, "別名の追加に失敗しました") };
    }
  }, initialCreateState);

  async function updateGameTitle(id: string, request: { name: string; layoutFamily: string }) {
    setOperationError(undefined);
    await patchGameTitle(id, {
      name: normalizeName(request.name),
      layoutFamily: normalizeLayoutFamily(request.layoutFamily),
    });
    await invalidateMasterResourceCaches(
      queryClient,
      masterQueryKeys.gameTitles(authScope),
      "game-titles",
    );
  }

  async function updateMapMaster(id: string, request: { name: string }) {
    setOperationError(undefined);
    await patchMapMaster(id, { name: normalizeName(request.name) });
    await invalidateMasterResourceCaches(
      queryClient,
      masterQueryKeys.mapMasters(authScope, viewModel.selectedGameTitleId),
      "map-masters",
    );
  }

  async function updateSeasonMaster(id: string, request: { name: string }) {
    setOperationError(undefined);
    await patchSeasonMaster(id, { name: normalizeName(request.name) });
    await invalidateMasterResourceCaches(
      queryClient,
      masterQueryKeys.seasonMasters(authScope, viewModel.selectedGameTitleId),
      "season-masters",
    );
  }

  async function updateMemberAlias(id: string, request: { memberId: string; alias: string }) {
    setOperationError(undefined);
    await patchMemberAlias(id, {
      memberId: normalizeName(request.memberId),
      alias: normalizeName(request.alias),
    });
    await queryClient.invalidateQueries({ queryKey: masterQueryKeys.memberAliases(authScope) });
  }

  async function deleteWithNotice(action: () => Promise<unknown>, fallback: string) {
    setOperationError(undefined);
    try {
      await action();
    } catch (error) {
      setOperationError(formatApiError(error, fallback));
    }
  }

  const hasPendingMutation =
    gameTitleCreatePending || mapCreatePending || seasonCreatePending || aliasCreatePending;

  const returnDestination =
    returnTo && handoffStatus === "available" && handoffId
      ? appendHandoffIdToReturnTo(returnTo, handoffId)
      : returnTo;

  return (
    <PageFrame className={sectionClass}>
      <PageHeader
        eyebrow="管理"
        title="設定管理"
        description="作品、読み取り方式、マップ、シーズン、名前の読み替えを管理します。"
        actions={
          returnTo ? (
            <Button
              variant="secondary"
              onClick={() => navigateWithTransition(returnDestination ?? "/matches")}
            >
              戻る
            </Button>
          ) : null
        }
      />

      {auth.error ? (
        <Notice tone="danger" title={auth.error.title}>
          {auth.error.detail}
        </Notice>
      ) : null}

      {operationError ? (
        <Notice tone="danger" title="設定の変更に失敗しました">
          {operationError}
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
        <Notice tone="danger" title="マップを読み込めませんでした">
          {errorMessage(mapMastersQuery.error)}
        </Notice>
      ) : null}
      {auth.isAuthenticated && shouldShowQueryError(seasonMastersQuery) ? (
        <Notice tone="danger" title="シーズンを読み込めませんでした">
          {errorMessage(seasonMastersQuery.error)}
        </Notice>
      ) : null}

      <section
        aria-label="設定管理の表示切替"
        className="flex flex-wrap gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-2"
      >
        {masterTabs.map((tab) => (
          <button
            key={tab.id}
            className={cn(
              "min-h-9 rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-semibold transition-colors duration-150",
              activeTab === tab.id
                ? "bg-[var(--color-surface-selected)] text-[var(--color-text-primary)]"
                : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-subtle)]",
            )}
            type="button"
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </section>

      {activeTab === "catalog" ? (
        <MasterRelationBoard
          gameTitles={optimisticGameTitles}
          selectedGameTitleId={viewModel.selectedGameTitleId}
          selectedGameTitleName={viewModel.selectedGameTitle?.name}
          onSelectGameTitle={setSelectedGameTitleId}
          onUpdateGameTitle={updateGameTitle}
          onDeleteGameTitle={(id) => {
            void deleteWithNotice(async () => {
              await removeGameTitle(id);
              if (selectedGameTitleId === id) setSelectedGameTitleId("");
              await invalidateMasterResourceCaches(
                queryClient,
                masterQueryKeys.gameTitles(authScope),
                "game-titles",
              );
            }, "作品の削除に失敗しました");
          }}
          gameTitleCreateAction={gameTitleCreateAction}
          gameTitleCreateError={gameTitleCreateState.error}
          gameTitleCreateFormKey={gameTitleCreateState.version}
          gameTitleDefaultLayoutFamily={normalizeLayoutFamily("")}
          mapMasters={viewModel.selectedMapMasters}
          onUpdateMapMaster={updateMapMaster}
          onDeleteMapMaster={(id) => {
            void deleteWithNotice(async () => {
              await removeMapMaster(id);
              await invalidateMasterResourceCaches(
                queryClient,
                masterQueryKeys.mapMasters(authScope, viewModel.selectedGameTitleId),
                "map-masters",
              );
            }, "マップの削除に失敗しました");
          }}
          mapCreateAction={mapCreateAction}
          mapCreateError={mapCreateState.error}
          mapCreateFormKey={mapCreateState.version}
          seasonMasters={viewModel.selectedSeasonMasters}
          onUpdateSeasonMaster={updateSeasonMaster}
          onDeleteSeasonMaster={(id) => {
            void deleteWithNotice(async () => {
              await removeSeasonMaster(id);
              await invalidateMasterResourceCaches(
                queryClient,
                masterQueryKeys.seasonMasters(authScope, viewModel.selectedGameTitleId),
                "season-masters",
              );
            }, "シーズンの削除に失敗しました");
          }}
          seasonCreateAction={seasonCreateAction}
          seasonCreateError={seasonCreateState.error}
          seasonCreateFormKey={seasonCreateState.version}
          scopedDisabledReason={viewModel.scopedDisabledReason}
        />
      ) : null}

      {activeTab === "aliases" ? (
        <MemberAliasPanel
          aliases={memberAliases}
          createAction={aliasCreateAction}
          createError={aliasCreateState.error}
          createFormKey={aliasCreateState.version}
          onDelete={(id) => {
            void deleteWithNotice(async () => {
              await removeMemberAlias(id);
              await queryClient.invalidateQueries({
                queryKey: masterQueryKeys.memberAliases(authScope),
              });
            }, "エイリアスの削除に失敗しました");
          }}
          onUpdate={updateMemberAlias}
        />
      ) : null}

      {activeTab === "incidents" ? <IncidentMasterPanel items={incidentMastersQuery.data} /> : null}

      {hasInvalidReturnTo ? (
        <Notice tone="warning" title="戻り先を確認できませんでした">
          戻り先を確認できないため、試合一覧へ戻る導線だけを表示しています。
        </Notice>
      ) : null}

      {viewModel.shouldPromptGameTitleCreation ? (
        <Notice tone="info" title="最初に作品を追加してください">
          マップとシーズンは作品を選んでから追加できます。
        </Notice>
      ) : null}
    </PageFrame>
  );
}
