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
