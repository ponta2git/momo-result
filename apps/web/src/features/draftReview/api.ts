import type { components } from "@/shared/api/generated";
import { apiRequest } from "@/shared/api/client";

export type HeldEventResponse = components["schemas"]["HeldEventResponse"];
export type HeldEventListResponse = components["schemas"]["HeldEventListResponse"];
export type CreateHeldEventRequest = components["schemas"]["CreateHeldEventRequest"];
export type OcrDraftResponse = components["schemas"]["OcrDraftResponse"];
export type OcrDraftListResponse = components["schemas"]["OcrDraftListResponse"];
export type ConfirmMatchRequest = components["schemas"]["ConfirmMatchRequest"];
export type ConfirmMatchResponse = components["schemas"]["ConfirmMatchResponse"];

export async function listHeldEvents(query = "", limit = 10): Promise<HeldEventListResponse> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (query.trim()) {
    params.set("q", query.trim());
  }
  return apiRequest<HeldEventListResponse>(`/api/held-events?${params.toString()}`);
}

export async function createHeldEvent(request: CreateHeldEventRequest): Promise<HeldEventResponse> {
  return apiRequest<HeldEventResponse>("/api/held-events", {
    method: "POST",
    body: request,
  });
}

export async function getOcrDraftsBulk(ids: string[]): Promise<OcrDraftListResponse> {
  const params = new URLSearchParams({ ids: ids.join(",") });
  return apiRequest<OcrDraftListResponse>(`/api/ocr-drafts?${params.toString()}`);
}

export async function confirmMatch(request: ConfirmMatchRequest): Promise<ConfirmMatchResponse> {
  return apiRequest<ConfirmMatchResponse>("/api/matches", {
    method: "POST",
    body: request,
  });
}
