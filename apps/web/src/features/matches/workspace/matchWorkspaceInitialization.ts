import { draftToMatchForm } from "@/features/matches/workspace/draftToMatchForm";
import {
  heldEventDefaultsById,
  latestHeldEventDefaults,
} from "@/features/matches/workspace/heldEventDefaults";
import { matchDetailToMatchForm } from "@/features/matches/workspace/matchDetailToMatchForm";
import { createEmptyMatchForm } from "@/features/matches/workspace/matchFormTypes";
import type {
  MatchFormValues,
  MatchWorkspaceInitialData,
  WorkspaceMode,
} from "@/features/matches/workspace/matchFormTypes";
import { createSampleDraftMap } from "@/features/matches/workspace/review/sampleDrafts";
import {
  draftsByKind,
  prefillFromDraftSummary,
} from "@/features/matches/workspace/workspaceDerivations";
import type { HeldEventResponse } from "@/shared/api/heldEvents";
import type {
  MatchDraftDetailResponse,
  MatchDraftSourceImageResponse,
} from "@/shared/api/matchDrafts";
import type { MatchDetailResponse } from "@/shared/api/matches";
import type { OcrDraftListResponse } from "@/shared/api/ocrDrafts";
import { isOcrRunning } from "@/shared/domain/draftStatus";
import { buildMemberAliasDirectory } from "@/shared/domain/memberDirectory";
import type { MemberAliasRecord } from "@/shared/domain/memberDirectory";
import type { SlotMap } from "@/shared/domain/slotMap";

export type InitializedWorkspaceSnapshot = {
  sourceImages: MatchDraftSourceImageResponse[];
  revision: string | undefined;
};

export type MatchWorkspaceInitializationSource = {
  draftDetail: MatchDraftDetailResponse | undefined;
  matchDetail: MatchDetailResponse | undefined;
  matchDraftId: string | undefined;
  memberAliases: readonly MemberAliasRecord[];
  mode: WorkspaceMode;
  ocrDrafts: OcrDraftListResponse | undefined;
  reviewDraftIdList: readonly string[];
  reviewDraftIds: SlotMap<string>;
  sourceImages: MatchDraftSourceImageResponse[] | undefined;
  useSampleDrafts: boolean;
};

export function isWorkspaceInitialDataReady(source: MatchWorkspaceInitializationSource): boolean {
  return source.mode === "edit"
    ? Boolean(source.matchDetail)
    : !isOcrRunning(source.draftDetail?.status) &&
        ((source.mode === "review" && source.useSampleDrafts) ||
          !source.matchDraftId ||
          Boolean(source.draftDetail)) &&
        (source.mode !== "review" ||
          source.useSampleDrafts ||
          source.reviewDraftIdList.length === 0 ||
          Boolean(source.ocrDrafts));
}

/** Builds initial values; the owner decides when to capture and commit the snapshot. */
export function buildWorkspaceInitialData(
  source: MatchWorkspaceInitializationSource,
  nowIso: string,
): {
  values: MatchFormValues;
  workspaceData: MatchWorkspaceInitialData | null;
  snapshot: InitializedWorkspaceSnapshot;
} {
  const snapshot = {
    sourceImages: source.mode === "edit" ? [] : (source.sourceImages ?? []),
    revision: source.mode === "edit" ? undefined : source.draftDetail?.updatedAt,
  };
  if (source.mode === "edit") {
    if (!source.matchDetail) throw new Error("Match detail is required to initialize an editor");
    return { values: matchDetailToMatchForm(source.matchDetail), workspaceData: null, snapshot };
  }
  if (source.mode === "create") {
    return {
      values: prefillFromDraftSummary(
        {
          ...createEmptyMatchForm(nowIso),
          ...(source.matchDraftId ? { matchDraftId: source.matchDraftId } : {}),
        },
        source.draftDetail,
      ),
      workspaceData: null,
      snapshot,
    };
  }
  const draftByKind = source.useSampleDrafts
    ? createSampleDraftMap()
    : draftsByKind(source.reviewDraftIds, source.ocrDrafts?.items);
  const prepared = draftToMatchForm({
    attachDraftIds: !source.useSampleDrafts,
    draftByKind,
    ...(source.draftDetail ? { draftSummary: source.draftDetail } : {}),
    ...(source.matchDraftId && !source.useSampleDrafts
      ? { matchDraftId: source.matchDraftId }
      : {}),
    memberDirectory: buildMemberAliasDirectory(source.memberAliases),
    nowIso,
  });
  return { values: prepared.values, workspaceData: prepared.initialData, snapshot };
}

export function initialWorkspaceHeldEventPatch(input: {
  initialized: boolean;
  mode: WorkspaceMode;
  heldEventId: string;
  heldEvents: readonly HeldEventResponse[];
  preferredHeldEventId: string | undefined;
  preferredHeldEventPending: boolean;
}) {
  return input.initialized &&
    input.mode !== "edit" &&
    !input.heldEventId &&
    !input.preferredHeldEventPending
    ? (heldEventDefaultsById(input.heldEvents, input.preferredHeldEventId) ??
        latestHeldEventDefaults(input.heldEvents))
    : undefined;
}
