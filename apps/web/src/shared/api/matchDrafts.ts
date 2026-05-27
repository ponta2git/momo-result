import { apiDownload, apiRequest } from "@/shared/api/client";
import type { ApiSignalOptions, IdempotencyRequestOptions } from "@/shared/api/client";
import type { components } from "@/shared/api/generated";

export type CreateMatchDraftRequest = components["schemas"]["CreateMatchDraftRequest"];
export type MatchDraftResponse = components["schemas"]["MatchDraftResponse"];
export type MatchDraftDetailResponse = components["schemas"]["MatchDraftDetailResponse"];
export type MatchDraftSourceImageListResponse =
  components["schemas"]["MatchDraftSourceImageListResponse"];
export type MatchDraftSourceImageResponse = components["schemas"]["MatchDraftSourceImageResponse"];
export type CancelMatchDraftResponse = components["schemas"]["CancelMatchDraftResponse"];

export async function createMatchDraft(
  request: CreateMatchDraftRequest,
  options: IdempotencyRequestOptions,
): Promise<MatchDraftResponse> {
  return apiRequest<MatchDraftResponse>("/api/match-drafts", {
    method: "POST",
    body: request,
    idempotency: { key: options.idempotencyKey },
  });
}

export async function getMatchDraftDetail(
  draftId: string,
  options: ApiSignalOptions = {},
): Promise<MatchDraftDetailResponse> {
  return apiRequest<MatchDraftDetailResponse>(
    `/api/match-drafts/${encodeURIComponent(draftId)}`,
    options,
  );
}

export async function listMatchDraftSourceImages(
  draftId: string,
  options: ApiSignalOptions = {},
): Promise<MatchDraftSourceImageListResponse> {
  return apiRequest<MatchDraftSourceImageListResponse>(
    `/api/match-drafts/${encodeURIComponent(draftId)}/source-images`,
    options,
  );
}

export async function downloadMatchDraftSourceImage(
  imageUrl: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const result = await apiDownload(imageUrl, signal ? { signal } : {});
  return result.blob;
}

export async function downloadMatchDraftSourceImagesArchive(draftId: string, signal?: AbortSignal) {
  return apiDownload(
    `/api/match-drafts/${encodeURIComponent(draftId)}/source-images.zip`,
    signal ? { signal } : {},
  );
}

export async function cancelMatchDraft(
  draftId: string,
  options: IdempotencyRequestOptions,
): Promise<CancelMatchDraftResponse> {
  return apiRequest<CancelMatchDraftResponse>(
    `/api/match-drafts/${encodeURIComponent(draftId)}/cancel`,
    {
      method: "POST",
      idempotency: { key: options.idempotencyKey },
    },
  );
}
