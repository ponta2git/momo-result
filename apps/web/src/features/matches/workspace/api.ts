import { apiDownload, apiRequest } from "@/shared/api/client";
import type { components } from "@/shared/api/generated";

export type MatchDraftSourceImageListResponse =
  components["schemas"]["MatchDraftSourceImageListResponse"];
export type MatchDraftSourceImageResponse = components["schemas"]["MatchDraftSourceImageResponse"];
export type CancelMatchDraftResponse = components["schemas"]["CancelMatchDraftResponse"];
export type MatchDraftDetailResponse = {
  matchDraftId: string;
  status: string;
  heldEventId?: string;
  matchNoInEvent?: number;
  gameTitleId?: string;
  seasonMasterId?: string;
  ownerMemberId?: string;
  mapMasterId?: string;
  playedAt?: string;
  totalAssetsDraftId?: string;
  revenueDraftId?: string;
  incidentLogDraftId?: string;
  totalAssetsImageId?: string;
  revenueImageId?: string;
  incidentLogImageId?: string;
  createdAt: string;
  updatedAt: string;
};

export async function listMatchDraftSourceImages(
  draftId: string,
): Promise<MatchDraftSourceImageListResponse> {
  return apiRequest<MatchDraftSourceImageListResponse>(
    `/api/match-drafts/${encodeURIComponent(draftId)}/source-images`,
  );
}

export async function downloadMatchDraftSourceImage(
  imageUrl: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const result = await apiDownload(imageUrl, signal ? { signal } : {});
  return result.blob;
}

export async function cancelMatchDraft(draftId: string): Promise<CancelMatchDraftResponse> {
  return apiRequest<CancelMatchDraftResponse>(
    `/api/match-drafts/${encodeURIComponent(draftId)}/cancel`,
    {
      method: "POST",
    },
  );
}

export async function getMatchDraftDetail(draftId: string): Promise<MatchDraftDetailResponse> {
  return apiRequest<MatchDraftDetailResponse>(`/api/match-drafts/${encodeURIComponent(draftId)}`);
}
