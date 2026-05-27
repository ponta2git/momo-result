import { apiRequest } from "@/shared/api/client";
import type { ApiSignalOptions } from "@/shared/api/client";
import type { components } from "@/shared/api/generated";

export type OcrDraftResponse = components["schemas"]["OcrDraftResponse"];
export type OcrDraftListResponse = components["schemas"]["OcrDraftListResponse"];

export async function getOcrDraft(
  draftId: string,
  options: ApiSignalOptions = {},
): Promise<OcrDraftResponse> {
  return apiRequest<OcrDraftResponse>(`/api/ocr-drafts/${encodeURIComponent(draftId)}`, options);
}

export async function getOcrDraftsBulk(
  ids: string[],
  options: ApiSignalOptions = {},
): Promise<OcrDraftListResponse> {
  const params = new URLSearchParams({ ids: ids.join(",") });
  return apiRequest<OcrDraftListResponse>(`/api/ocr-drafts?${params.toString()}`, options);
}
