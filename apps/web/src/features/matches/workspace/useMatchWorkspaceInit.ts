import { useEffect, useRef } from "react";

import { createSampleDraftMap } from "@/features/draftReview/sampleDrafts";
import type { getMatch } from "@/features/matches/api";
import type { getMatchDraftDetail, getOcrDraftsBulk } from "@/features/matches/workspace/api";
import { draftToMatchForm } from "@/features/matches/workspace/draftToMatchForm";
import { matchDetailToMatchForm } from "@/features/matches/workspace/matchDetailToMatchForm";
import type {
  MatchFormValues,
  MatchWorkspaceInitialData,
  WorkspaceMode,
} from "@/features/matches/workspace/matchFormTypes";
import {
  draftsByKind,
  prefillFromDraftSummary,
} from "@/features/matches/workspace/workspaceDerivations";
import type { SlotMap } from "@/shared/lib/slotMap";

type MatchDetail = Awaited<ReturnType<typeof getMatch>>;
type DraftDetail = Awaited<ReturnType<typeof getMatchDraftDetail>>;
type OcrDraftBulk = Awaited<ReturnType<typeof getOcrDraftsBulk>>;

export type MatchWorkspaceInitParams = {
  draftDetail: DraftDetail | undefined;
  draftDetailLoading: boolean;
  matchDetail: MatchDetail | undefined;
  matchDraftId: string | undefined;
  matchId: string | undefined;
  mode: WorkspaceMode;
  ocrDrafts: OcrDraftBulk | undefined;
  ocrDraftsError: boolean;
  onInitialize: (values: MatchFormValues, workspaceData: MatchWorkspaceInitialData | null) => void;
  reviewDraftIdList: readonly string[];
  reviewDraftIds: SlotMap<string>;
  useSampleDrafts: boolean;
  emptyFormFactory: () => MatchFormValues;
};

/**
 * モード別の初期化（edit: 既存試合 / create: 下書き / review: OCR 結果）を担う Hook。
 *
 * - 入力キー（mode + ids + 取得データの updatedAt 等）が変化したときのみ初期化する
 * - 初期化結果は呼び出し側 onInitialize コールバックで反映する
 * - 初期化済み状態は内部 ref で保持する（フラグの取得は isInitialized 戻り値）
 */
export function useMatchWorkspaceInit({
  draftDetail,
  draftDetailLoading,
  matchDetail,
  matchDraftId,
  matchId,
  mode,
  ocrDrafts,
  ocrDraftsError,
  onInitialize,
  reviewDraftIdList,
  reviewDraftIds,
  useSampleDrafts,
  emptyFormFactory,
}: MatchWorkspaceInitParams): { isInitialized: boolean } {
  const initializedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const initKey = JSON.stringify({
      draftSummaryUpdatedAt: draftDetail?.updatedAt,
      hasLegacyDrafts: reviewDraftIdList.join(","),
      matchDraftId,
      matchId,
      mode,
      sample: useSampleDrafts,
    });

    if (initializedKeyRef.current === initKey) {
      return;
    }

    if (mode === "edit") {
      if (!matchDetail) {
        return;
      }
      onInitialize(matchDetailToMatchForm(matchDetail), null);
      initializedKeyRef.current = initKey;
      return;
    }

    if (mode === "create") {
      if (matchDraftId && draftDetailLoading) {
        return;
      }
      const base = prefillFromDraftSummary(
        {
          ...emptyFormFactory(),
          ...(matchDraftId ? { matchDraftId } : {}),
        },
        draftDetail ?? undefined,
      );
      onInitialize(base, null);
      initializedKeyRef.current = initKey;
      return;
    }

    if (mode === "review") {
      if (!useSampleDrafts && reviewDraftIdList.length > 0 && !ocrDrafts && !ocrDraftsError) {
        return;
      }
      const draftByKind = useSampleDrafts
        ? createSampleDraftMap()
        : draftsByKind(reviewDraftIds, ocrDrafts?.items);

      const prepared = draftToMatchForm({
        draftByKind,
        ...(draftDetail ? { draftSummary: draftDetail } : {}),
        ...(matchDraftId ? { matchDraftId } : {}),
        nowIso: new Date().toISOString(),
      });

      onInitialize(prepared.values, prepared.initialData);
      initializedKeyRef.current = initKey;
    }
  }, [
    draftDetail,
    draftDetailLoading,
    matchDetail,
    matchDraftId,
    matchId,
    mode,
    ocrDrafts,
    ocrDraftsError,
    onInitialize,
    reviewDraftIdList,
    reviewDraftIds,
    useSampleDrafts,
    emptyFormFactory,
  ]);

  return { isInitialized: initializedKeyRef.current != null };
}
