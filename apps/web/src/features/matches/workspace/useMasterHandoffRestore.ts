import { useEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import type { WorkspaceMode } from "@/features/matches/workspace/matchFormTypes";
import {
  clearHandoffIdFromSearch,
  findLatestMasterHandoff,
  loadMasterHandoff,
  removeMasterHandoff,
  sanitizeReturnTo,
} from "@/shared/workflows/masterReturnHandoff";
import type { MasterHandoffPayload } from "@/shared/workflows/masterReturnHandoff";

export type MasterHandoffRestoreParams = {
  isInitialized: boolean;
  matchSessionId: string | undefined;
  mode: WorkspaceMode;
  onRestore: (payload: MasterHandoffPayload) => void;
  onRestoreFailed: () => void;
  searchParams: URLSearchParams;
};

export type MasterHandoffRestoreResult = {
  returnSearch: string;
  returnTo: string | undefined;
};

/**
 * マスタ管理画面から戻った際の sessionStorage handoff 復元を担う Hook。
 *
 * - 副作用は consume 後の navigate / removeMasterHandoff のみ
 * - handoffId 単位で冪等
 * - 復元結果は呼び出し側 onRestore コールバックで反映する
 */
export function useMasterHandoffRestore({
  isInitialized,
  matchSessionId,
  mode,
  onRestore,
  onRestoreFailed,
  searchParams,
}: MasterHandoffRestoreParams): MasterHandoffRestoreResult {
  const navigate = useNavigate();
  const location = useLocation();
  const processedHandoffIdsRef = useRef(new Set<string>());

  const returnSearchParams = useMemo(() => clearHandoffIdFromSearch(searchParams), [searchParams]);
  const returnSearch = returnSearchParams.toString();
  const returnTo = sanitizeReturnTo(
    `${location.pathname}${returnSearch ? `?${returnSearch}` : ""}`,
  );

  useEffect(() => {
    if (mode !== "review" && mode !== "create") {
      return;
    }
    if (!isInitialized) {
      return;
    }

    const handoffId = searchParams.get("handoffId");
    if (!handoffId || !returnTo) {
      return;
    }
    if (processedHandoffIdsRef.current.has(handoffId)) {
      return;
    }
    processedHandoffIdsRef.current.add(handoffId);

    const payload =
      loadMasterHandoff({
        expectedMatchSessionId: matchSessionId,
        expectedReturnTo: returnTo,
        handoffId,
      }) ??
      loadMasterHandoff({
        expectedMatchSessionId: matchSessionId,
        expectedReturnTo: location.pathname,
        handoffId,
      });
    const fallbackRecord =
      payload || !matchSessionId
        ? undefined
        : (findLatestMasterHandoff({
            expectedMatchSessionId: matchSessionId,
            expectedReturnTo: returnTo,
          }) ??
          findLatestMasterHandoff({
            expectedMatchSessionId: matchSessionId,
            expectedReturnTo: location.pathname,
          }));
    const restoredPayload = payload ?? fallbackRecord?.payload;
    const consumedHandoffId = payload ? handoffId : (fallbackRecord?.handoffId ?? handoffId);

    if (restoredPayload?.source === "draftReview") {
      onRestore(restoredPayload);
    } else {
      onRestoreFailed();
    }

    removeMasterHandoff(consumedHandoffId ?? null);
    navigate(
      {
        pathname: location.pathname,
        search: returnSearch ? `?${returnSearch}` : "",
      },
      { replace: true },
    );
  }, [
    isInitialized,
    location.pathname,
    matchSessionId,
    mode,
    navigate,
    onRestore,
    onRestoreFailed,
    returnSearch,
    returnTo,
    searchParams,
  ]);

  return { returnSearch, returnTo };
}
