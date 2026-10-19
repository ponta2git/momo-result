import type { ApiSignalOptions } from "@/shared/api/client";
import { getHeldEventDetail } from "@/shared/api/heldEvents";
import type { HeldEventDetailResponse } from "@/shared/api/heldEvents";
import { getMatch } from "@/shared/api/matches";
import type { MatchDetailResponse } from "@/shared/api/matches";
import { normalizeUnknownApiError } from "@/shared/api/problemDetails";
import type { NormalizedApiError } from "@/shared/api/problemDetails";

export type MatchNeighbor = NonNullable<MatchDetailResponse["navigation"]["previous"]>;
export type HeldEventNeighbor = NonNullable<HeldEventDetailResponse["navigation"]["previous"]>;

export type DetailNavigation<N> =
  | { kind: "available"; previous: N | undefined; next: N | undefined }
  | { kind: "unavailable" };

export type DetailReadResult<D, N> =
  | { kind: "found"; detail: D; navigation: DetailNavigation<N> }
  | { kind: "notFound"; error: NormalizedApiError };

export type MatchDetailReadResult = DetailReadResult<MatchDetailResponse, MatchNeighbor>;
export type HeldEventDetailReadResult = DetailReadResult<
  HeldEventDetailResponse,
  HeldEventNeighbor
>;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /T.*(?:Z|[+-]\d{2}:\d{2})$/u.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function isMatchNeighbor(value: unknown): value is MatchNeighbor {
  return (
    isObject(value) &&
    isId(value["matchId"]) &&
    isId(value["heldEventId"]) &&
    isTimestamp(value["playedAt"]) &&
    isTimestamp(value["heldAt"]) &&
    typeof value["matchNoInEvent"] === "number" &&
    Number.isSafeInteger(value["matchNoInEvent"]) &&
    value["matchNoInEvent"] > 0
  );
}

function isHeldEventNeighbor(value: unknown): value is HeldEventNeighbor {
  return isObject(value) && isId(value["id"]) && isTimestamp(value["heldAt"]);
}

/** This boundary validates only the added navigation contract, including older API responses. */
function readNavigation<N>(
  value: unknown,
  validate: (candidate: unknown) => candidate is N,
  identity: (candidate: N) => string,
  currentId: string,
): DetailNavigation<N> {
  if (!isObject(value)) return { kind: "unavailable" };
  const previous = value["previous"];
  const next = value["next"];
  if ((previous != null && !validate(previous)) || (next != null && !validate(next))) {
    return { kind: "unavailable" };
  }
  const before = validate(previous) ? previous : undefined;
  const after = validate(next) ? next : undefined;
  if (
    (before && identity(before) === currentId) ||
    (after && identity(after) === currentId) ||
    (before && after && identity(before) === identity(after))
  )
    return { kind: "unavailable" };
  return { kind: "available", previous: before, next: after };
}

async function loadDetail<D, N>(
  load: () => Promise<D>,
  navigation: (detail: D) => DetailNavigation<N>,
): Promise<DetailReadResult<D, N>> {
  try {
    const detail = await load();
    return { kind: "found", detail, navigation: navigation(detail) };
  } catch (error) {
    const problem = normalizeUnknownApiError(error);
    if (problem.status === 404 && problem.code === "NOT_FOUND") {
      return { kind: "notFound", error: problem };
    }
    throw error;
  }
}

export function loadMatchDetail(
  matchId: string,
  options: ApiSignalOptions,
): Promise<MatchDetailReadResult> {
  return loadDetail(
    () => getMatch(matchId, options),
    (detail) =>
      readNavigation(detail.navigation, isMatchNeighbor, (neighbor) => neighbor.matchId, matchId),
  );
}

export function loadHeldEventDetail(
  heldEventId: string,
  options: ApiSignalOptions,
): Promise<HeldEventDetailReadResult> {
  return loadDetail(
    () => getHeldEventDetail(heldEventId, options),
    (detail) =>
      readNavigation(
        detail.navigation,
        isHeldEventNeighbor,
        (neighbor) => neighbor.id,
        heldEventId,
      ),
  );
}

export function readDetailQuery<D, N>(query: {
  data: DetailReadResult<D, N> | undefined;
  error: unknown;
}) {
  return {
    detail: query.data?.kind === "found" ? query.data.detail : undefined,
    navigation: query.data?.kind === "found" ? query.data.navigation : undefined,
    notFound: query.data?.kind === "notFound",
    error: query.data?.kind === "notFound" ? query.data.error : query.error,
  };
}
