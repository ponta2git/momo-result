import type { ApiSignalOptions } from "@/shared/api/client";
import { normalizeUnknownApiError } from "@/shared/api/problemDetails";
import type { NormalizedApiError } from "@/shared/api/problemDetails";
import { getSeriesAnalysisMatchContext } from "@/shared/api/seriesAnalysis";
import type {
  SeriesAnalysisMatchContextQuery,
  SeriesAnalysisMatchContextV3,
} from "@/shared/api/seriesAnalysis";

type MatchContextResult =
  | { kind: "available"; context: SeriesAnalysisMatchContextV3 }
  | { kind: "unavailable"; error: NormalizedApiError };

/**
 * Cache a definitive negative result in place of the invalid context. A later transport failure
 * may retain that result, but cannot resurrect a match that the server already invalidated.
 * Both screens share this query value; only a successful context read restores its contents.
 */
export async function loadSeriesAnalysisMatchContext(
  query: SeriesAnalysisMatchContextQuery,
  options: ApiSignalOptions,
): Promise<MatchContextResult> {
  try {
    return { kind: "available", context: await getSeriesAnalysisMatchContext(query, options) };
  } catch (error) {
    const problem = normalizeUnknownApiError(error);
    if (
      (problem.status === 404 && problem.code === "NOT_FOUND") ||
      (problem.status === 410 && problem.code === "ANALYSIS_ARTIFACT_EXPIRED")
    ) {
      return { kind: "unavailable", error: problem };
    }
    throw error;
  }
}

export function readSeriesAnalysisMatchContext(query: {
  data: MatchContextResult | undefined;
  error: unknown;
}) {
  return {
    context: query.data?.kind === "available" ? query.data.context : undefined,
    error: query.data?.kind === "unavailable" ? query.data.error : query.error,
    unavailable: query.data?.kind === "unavailable",
  };
}
