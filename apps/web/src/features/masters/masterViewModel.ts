import type { MasterViewModelInput } from "@/features/masters/masterTypes";
import type { GameTitleResponse, MemberAliasResponse } from "@/shared/api/masters";
import { normalizeUnknownApiError } from "@/shared/api/problemDetails";
import { canonicalResultMembers } from "@/shared/domain/members";
import { layoutFamilyLabels } from "@/shared/domain/ocr";
import type { LayoutFamily } from "@/shared/domain/ocr";

export function masterResourceErrorMessage(error: unknown): string | undefined {
  if (!error) return undefined;
  const normalized = normalizeUnknownApiError(error);
  return normalized.detail || normalized.title;
}

/** Cached empty directories remain usable; only a failed initial read replaces the body. */
export function masterDirectoryState(input: {
  hasData: boolean;
  failed: boolean;
  initialLoading: boolean;
  fetching: boolean;
  mutationPending: boolean;
}) {
  return {
    hasData: input.hasData,
    loadFailed: input.failed && !input.hasData,
    loading: input.initialLoading && !input.failed,
    refreshing: input.fetching && !input.mutationPending,
    stale: input.failed && input.hasData,
  };
}

export function masterAliasGroups(aliases: ReadonlyArray<Readonly<MemberAliasResponse>>) {
  return canonicalResultMembers.map((member) => ({
    member,
    aliases: aliases.filter((alias) => alias.memberId === member.memberId),
  }));
}

export function buildMasterViewModel({
  gameTitles,
  mapMasters,
  seasonMasters,
  selectedGameTitleId,
}: MasterViewModelInput) {
  const selectedGameTitle = gameTitles.find((item) => item.id === selectedGameTitleId);
  const selectedId = selectedGameTitle?.id ?? "";
  const selectedMapMasters = selectedId
    ? mapMasters.filter((item) => item.gameTitleId === selectedId)
    : [];
  const selectedSeasonMasters = selectedId
    ? seasonMasters.filter((item) => item.gameTitleId === selectedId)
    : [];

  return {
    canCreateScopedMasters: Boolean(selectedGameTitle),
    scopedDisabledReason: selectedGameTitle
      ? undefined
      : "作品を追加すると、マップとシーズンを登録できます。",
    selectedGameTitle,
    selectedGameTitleId: selectedId,
    selectedMapMasters,
    selectedSeasonMasters,
    shouldPromptGameTitleCreation: gameTitles.length === 0,
  };
}

export function resolveMasterSelectionId(
  titles: ReadonlyArray<{ id: string }>,
  selectedId: string,
  fallbackId = titles[0]?.id ?? "",
): string {
  return titles.some((title) => title.id === selectedId) ? selectedId : fallbackId;
}

export function scopedMasterPanelView(
  list: {
    loading?: boolean | undefined;
    loadFailed: boolean;
    hasData: boolean;
    stale: boolean;
    error?: string | undefined;
  },
  itemLabel: string,
  disabledReason: string | undefined,
) {
  const loading = list.loading ?? false;
  const loadBlocked = list.loadFailed && !list.hasData;
  return {
    loading,
    loadBlocked,
    showStaleError: list.stale && list.hasData && Boolean(list.error),
    createDisabled: loading || loadBlocked || Boolean(disabledReason),
    createDisabledReason: loading
      ? `${itemLabel}を読み込み中です。`
      : loadBlocked
        ? `${itemLabel}を読み込んでから追加できます。`
        : disabledReason,
  };
}

export function masterGameTitleChoices(
  items: ReadonlyArray<Readonly<GameTitleResponse & { pending?: boolean }>>,
  canEdit: boolean,
) {
  return items.map((item) => {
    const pending = item.pending === true;
    return {
      item,
      pending,
      editable: canEdit && !pending,
      accessibleLabel: `${item.name}${pending ? "（追加中）" : ""}`,
      description: `読み取り方式: ${layoutFamilyLabels[item.layoutFamily as LayoutFamily] ?? "未設定"}`,
    };
  });
}

export function incidentMasterCountIssue(actualCount: number, stale: boolean) {
  const expectedCount = 6;
  return actualCount === expectedCount || stale ? undefined : { actualCount, expectedCount };
}
