import { normalizeUnknownApiError } from "@/shared/api/problemDetails";

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
