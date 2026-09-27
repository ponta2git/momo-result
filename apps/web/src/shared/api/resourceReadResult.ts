import { normalizeUnknownApiError } from "@/shared/api/problemDetails";

export type ResourceReadResult<T> = { kind: "found"; value: T } | { kind: "notFound" };

/** A confirmed absence replaces stale data; transport failures keep the last known result. */
export async function loadResourceReadResult<T>(
  load: () => Promise<T>,
): Promise<ResourceReadResult<T>> {
  try {
    return { kind: "found", value: await load() };
  } catch (error) {
    const problem = normalizeUnknownApiError(error);
    if (problem.status === 404 && problem.code === "NOT_FOUND") {
      return { kind: "notFound" };
    }
    throw error;
  }
}
