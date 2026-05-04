import { apiRequest } from "@/shared/api/client";
import type { components } from "@/shared/api/generated";

export type OcrDraftResponse = components["schemas"]["OcrDraftResponse"];
export type OcrDraftListResponse = components["schemas"]["OcrDraftListResponse"];

export async function getOcrDraftsBulk(ids: string[]): Promise<OcrDraftListResponse> {
  const params = new URLSearchParams({ ids: ids.join(",") });
  return apiRequest<OcrDraftListResponse>(`/api/ocr-drafts?${params.toString()}`);
}
