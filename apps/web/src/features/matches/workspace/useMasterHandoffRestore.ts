import { useEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import {
  clearHandoffIdFromSearch,
  loadMasterHandoff,
  removeMasterHandoff,
  sanitizeReturnTo,
} from "@/features/masters/masterReturnHandoff";
import type { MasterHandoffPayload } from "@/features/masters/masterReturnHandoff";
import type { WorkspaceMode } from "@/features/matches/workspace/matchFormTypes";

const HANDOFF_KEY_PREFIX = "momoresult.masterHandoff.";

function loadMasterHandoffFallback(handoffId: string): MasterHandoffPayload | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  try {
    const raw = window.sessionStorage.getItem(`${HANDOFF_KEY_PREFIX}${handoffId}`);
    if (!raw) {
      return undefined;
    }
    const parsed = JSON.parse(raw) as Partial<MasterHandoffPayload>;
    if (parsed.source !== "draftReview" || !parsed.values) {
      return undefined;
    }
    return parsed as MasterHandoffPayload;
  } catch {
    return undefined;
  }
}

function findLatestDraftReviewHandoff(matchSessionId: string | undefined): {
  handoffId: string;
  payload: MasterHandoffPayload;
} | null {
  if (typeof window === "undefined") {
    return null;
  }

  const candidates: Array<{ handoffId: string; payload: MasterHandoffPayload }> = [];
  for (let index = 0; index < window.sessionStorage.length; index += 1) {
    const key = window.sessionStorage.key(index);
    if (!key?.startsWith(HANDOFF_KEY_PREFIX)) {
      continue;
    }
    const handoffId = key.slice(HANDOFF_KEY_PREFIX.length);
    const payload = loadMasterHandoffFallback(handoffId);
    if (!payload || payload.source !== "draftReview") {
      continue;
    }
    if (matchSessionId && payload.matchSessionId !== matchSessionId) {
      continue;
    }
    candidates.push({ handoffId, payload });
  }

  if (candidates.length === 0) {
    return null;
  }

  const sorted = candidates.toSorted(
    (left, right) => Date.parse(right.payload.createdAt) - Date.parse(left.payload.createdAt),
  );
  return sorted[0] ?? null;
}

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

  const returnSearchParams = useMemo(
    () => clearHandoffIdFromSearch(searchParams),
    [searchParams],
  );
  const returnSearch = returnSearchParams.toString();
  const returnTo = sanitizeReturnTo(
    `${location.pathname}${returnSearch ? `?${returnSearch}` : ""}`,
  );

  useEffect(() => {
    if (mode !== "review") {
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
      loadMasterHandoff({ expectedReturnTo: returnTo, handoffId }) ??
      loadMasterHandoff({ expectedReturnTo: location.pathname, handoffId }) ??
      loadMasterHandoffFallback(handoffId);
    const fallbackRecord = payload ? null : findLatestDraftReviewHandoff(matchSessionId);
    const restoredPayload = payload ?? fallbackRecord?.payload;
    const consumedHandoffId = handoffId ?? fallbackRecord?.handoffId;

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
