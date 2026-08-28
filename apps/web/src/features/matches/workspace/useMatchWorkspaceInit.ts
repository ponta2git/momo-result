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
import type { getMatchDraftDetail } from "@/shared/api/matchDrafts";
import type { getMatch } from "@/shared/api/matches";
import type { getOcrDraftsBulk } from "@/shared/api/ocrDrafts";
import { buildMemberAliasDirectory } from "@/shared/domain/memberDirectory";
import type { MemberAliasRecord } from "@/shared/domain/memberDirectory";
import type { SlotMap } from "@/shared/lib/slotMap";

type MatchDetail = Awaited<ReturnType<typeof getMatch>>;
type DraftDetail = Awaited<ReturnType<typeof getMatchDraftDetail>>;
type OcrDraftBulk = Awaited<ReturnType<typeof getOcrDraftsBulk>>;

export type MatchWorkspaceInitParams = {
  draftDetail: DraftDetail | undefined;
  matchDetail: MatchDetail | undefined;
  matchDraftId: string | undefined;
  memberAliases: readonly MemberAliasRecord[];
  mode: WorkspaceMode;
  ocrDrafts: OcrDraftBulk | undefined;
  onInitialize: (values: MatchFormValues, workspaceData: MatchWorkspaceInitialData | null) => void;
  reviewDraftIdList: readonly string[];
  reviewDraftIds: SlotMap<string>;
  useSampleDrafts: boolean;
  emptyFormFactory: () => MatchFormValues;
  nowIsoFactory: () => string;
};

/**
 * モード別の初期化（edit: 既存試合 / create: 下書き / review: OCR 結果）を担う Hook。
 *
 * - semantic workspace の切替は owning component の key で分離する
 * - 同じ workspace 内で OCR source IDs が変化したときだけ再初期化する
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
  useSampleDrafts,
  emptyFormFactory,
  nowIsoFactory,
}: MatchWorkspaceInitParams): { isInitialized: boolean } {
  const initializedSourceKeyRef = useRef<string | null>(null);
  const [initializedSourceKey, setInitializedSourceKey] = useState<string | null>(null);
  const sourceKey = JSON.stringify(reviewDraftIdList);
  useEffect(() => {
    if (initializedSourceKeyRef.current === sourceKey) {
      return;
    }

    if (mode === "edit") {
      if (!matchDetail) {
        return;
      }
      onInitialize(matchDetailToMatchForm(matchDetail), null);
      initializedSourceKeyRef.current = sourceKey;
      setInitializedSourceKey(sourceKey);
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
      initializedSourceKeyRef.current = sourceKey;
      setInitializedSourceKey(sourceKey);
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
      initializedSourceKeyRef.current = sourceKey;
      setInitializedSourceKey(sourceKey);
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
    useSampleDrafts,
    emptyFormFactory,
    nowIsoFactory,
    sourceKey,
  ]);

  return { isInitialized: initializedSourceKey === sourceKey };
}
