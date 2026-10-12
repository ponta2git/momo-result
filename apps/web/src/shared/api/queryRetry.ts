import { normalizeUnknownApiError } from "@/shared/api/problemDetails";

/** Authentication failures need an explicit recovery, not a repeated protected request. */
export function retryProtectedQuery(failureCount: number, error: unknown): boolean {
  const { status } = normalizeUnknownApiError(error);
  return status !== 401 && status !== 403 && failureCount < 1;
}
