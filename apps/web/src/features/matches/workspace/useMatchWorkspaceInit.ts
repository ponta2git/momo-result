import { useEffect, useRef, useState } from "react";

import { draftToMatchForm } from "@/features/matches/workspace/draftToMatchForm";
import { matchDetailToMatchForm } from "@/features/matches/workspace/matchDetailToMatchForm";
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
import type { getMatchDraftDetail, MatchDraftSourceImageResponse } from "@/shared/api/matchDrafts";
import type { getMatch } from "@/shared/api/matches";
import type { OcrDraftListResponse } from "@/shared/api/ocrDrafts";
import { isOcrRunning } from "@/shared/domain/draftStatus";
import { buildMemberAliasDirectory } from "@/shared/domain/memberDirectory";
import type { MemberAliasRecord } from "@/shared/domain/memberDirectory";
import type { SlotMap } from "@/shared/domain/slotMap";

type MatchDetail = Awaited<ReturnType<typeof getMatch>>;
type DraftDetail = Awaited<ReturnType<typeof getMatchDraftDetail>>;

export type MatchWorkspaceInitParams = {
  draftDetail: DraftDetail | undefined;
  matchDetail: MatchDetail | undefined;
  matchDraftId: string | undefined;
  memberAliases: readonly MemberAliasRecord[];
  mode: WorkspaceMode;
  ocrDrafts: OcrDraftListResponse | undefined;
  onInitialize: (values: MatchFormValues, workspaceData: MatchWorkspaceInitialData | null) => void;
  reviewDraftIdList: readonly string[];
  reviewDraftIds: SlotMap<string>;
  sourceImages: MatchDraftSourceImageResponse[] | undefined;
  useSampleDrafts: boolean;
  emptyFormFactory: () => MatchFormValues;
  nowIsoFactory: () => string;
};

/**
 * モード別の初期化（edit: 既存試合 / create: 下書き / review: OCR 結果）を担う Hook。
 *
 * - semantic workspace の切替は owning component の key で分離する
 * - 編集を開始できる snapshot で一度だけ初期化し、後続の取得で入力を置き換えない
 * - 初期化結果は呼び出し側の安定した onInitialize command で一括反映する
 * - effect の多重実行は ref で防ぎ、描画に使う初期化状態は state で公開する
 */
export function useMatchWorkspaceInit({
  draftDetail,
  matchDetail,
  matchDraftId,
  memberAliases,
  mode,
  ocrDrafts,
  onInitialize,
  reviewDraftIdList,
  reviewDraftIds,
  sourceImages,
  useSampleDrafts,
  emptyFormFactory,
  nowIsoFactory,
}: MatchWorkspaceInitParams) {
  const initializedRef = useRef(false);
  const [initializedSnapshot, setInitializedSnapshot] = useState<{
    sourceImages: MatchDraftSourceImageResponse[];
    revision: string | undefined;
  } | null>(null);
  useEffect(() => {
    if (initializedRef.current || (mode !== "edit" && isOcrRunning(draftDetail?.status))) {
      return;
    }

    if (mode === "edit") {
      if (!matchDetail) {
        return;
      }
      onInitialize(matchDetailToMatchForm(matchDetail), null);
      initializedRef.current = true;
      // Publish readiness after the form initialization command has run in this commit.
      // oxlint-disable-next-line react/set-state-in-effect
      setInitializedSnapshot({ sourceImages: [], revision: undefined });
      return;
    }

    if (mode === "create") {
      if (matchDraftId && !draftDetail) return;
      const base = prefillFromDraftSummary(
        {
          ...emptyFormFactory(),
          ...(matchDraftId ? { matchDraftId } : {}),
        },
        draftDetail ?? undefined,
      );
      onInitialize(base, null);
      initializedRef.current = true;
      setInitializedSnapshot({
        sourceImages: sourceImages ?? [],
        revision: draftDetail?.updatedAt,
      });
      return;
    }

    if (mode === "review") {
      if (!useSampleDrafts && matchDraftId && !draftDetail) return;
      if (!useSampleDrafts && reviewDraftIdList.length > 0 && !ocrDrafts) return;
      const draftByKind = useSampleDrafts
        ? createSampleDraftMap()
        : draftsByKind(reviewDraftIds, ocrDrafts?.items);

      const prepared = draftToMatchForm({
        attachDraftIds: !useSampleDrafts,
        draftByKind,
        ...(draftDetail ? { draftSummary: draftDetail } : {}),
        ...(matchDraftId && !useSampleDrafts ? { matchDraftId } : {}),
        memberDirectory: buildMemberAliasDirectory(memberAliases),
        nowIso: nowIsoFactory(),
      });

      onInitialize(prepared.values, prepared.initialData);
      initializedRef.current = true;
      setInitializedSnapshot({
        sourceImages: sourceImages ?? [],
        revision: draftDetail?.updatedAt,
      });
    }
  }, [
    draftDetail,
    matchDetail,
    matchDraftId,
    memberAliases,
    mode,
    ocrDrafts,
    onInitialize,
    reviewDraftIdList,
    reviewDraftIds,
    sourceImages,
    useSampleDrafts,
    emptyFormFactory,
    nowIsoFactory,
  ]);

  return { isInitialized: initializedSnapshot !== null, initializedSnapshot };
}
