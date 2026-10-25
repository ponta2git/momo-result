import { apiRequest } from "@/shared/api/client";
import type { ApiSignalOptions, IdempotencyRequestOptions } from "@/shared/api/client";
import type { components } from "@/shared/api/generated";
import { decodeSeriesAnalysisArtifact } from "@/shared/api/seriesAnalysisArtifactDecoder";

type CatalogResponse = components["schemas"]["AchievementCatalogResponse"];
type ItemResponse = components["schemas"]["AchievementItemResponse"];
export type AchievementCatalog = Omit<CatalogResponse, "items" | "claims" | "members" | "maps"> & {
  items: AchievementItem[];
  claims: NonNullable<CatalogResponse["claims"]>;
  members: NonNullable<CatalogResponse["members"]>;
  maps: NonNullable<CatalogResponse["maps"]>;
};
export type AchievementItem = ItemResponse & { mapMasterIds: string[] };
export type AchievementClaim = components["schemas"]["AchievementClaimResponse"];
export type AchievementResource = components["schemas"]["SeriesAnalysisAchievementsResponse"];
export type CreateAchievementRequest = components["schemas"]["CreateAchievementRequest"];
export type UpdateAchievementRequest = components["schemas"]["UpdateAchievementRequest"];
export type RetireAchievementRequest = components["schemas"]["RetireAchievementRequest"];
export type ReorderAchievementsRequest = components["schemas"]["ReorderAchievementsRequest"];
export type CorrectAchievementClaimRequest =
  components["schemas"]["CorrectAchievementClaimRequest"];
export type AddMatchAchievementRequest = components["schemas"]["AddMatchAchievementRequest"];
export type AddMatchAchievementsRequest = components["schemas"]["AddMatchAchievementsRequest"];
export type AchievementSavedResponse = components["schemas"]["AchievementSavedResponse"];

export async function getAchievementCatalog(
  gameTitleId: string,
  options: ApiSignalOptions = {},
): Promise<AchievementCatalog> {
  const response = await apiRequest<CatalogResponse>(
    `/api/achievements/catalog?gameTitleId=${encodeURIComponent(gameTitleId)}`,
    options,
  );
  return normalizeCatalog(response);
}

function normalizeCatalog(response: CatalogResponse): AchievementCatalog {
  return {
    ...response,
    items: (response.items ?? []).map(normalizeItem),
    claims: response.claims ?? [],
    members: response.members ?? [],
    maps: response.maps ?? [],
  };
}

export function reorderAchievements(
  request: ReorderAchievementsRequest,
  options: IdempotencyRequestOptions,
): Promise<AchievementCatalog> {
  return apiRequest<CatalogResponse>("/api/achievements/catalog/order", {
    method: "PUT",
    body: request,
    idempotency: { key: options.idempotencyKey },
  }).then(normalizeCatalog);
}

function normalizeItem(item: ItemResponse): AchievementItem {
  return { ...item, mapMasterIds: item.mapMasterIds ?? [] };
}

export function getAchievements(
  gameTitleId: string,
  artifactId: string,
  options: ApiSignalOptions = {},
) {
  const query = new URLSearchParams({ gameTitleId, artifactId });
  return apiRequest<AchievementResource>(`/api/achievements?${query.toString()}`, {
    ...options,
    decodeResponse: (value) => decodeSeriesAnalysisArtifact("achievements", value),
  });
}

export function createAchievement(
  request: CreateAchievementRequest,
  options: IdempotencyRequestOptions,
) {
  return apiRequest<ItemResponse>("/api/achievements/items", {
    method: "POST",
    body: request,
    idempotency: { key: options.idempotencyKey },
  }).then(normalizeItem);
}

export function updateAchievement(
  achievementId: string,
  request: UpdateAchievementRequest,
  options: IdempotencyRequestOptions,
) {
  return apiRequest<ItemResponse>(`/api/achievements/items/${encodeURIComponent(achievementId)}`, {
    method: "PUT",
    body: request,
    idempotency: { key: options.idempotencyKey },
  }).then(normalizeItem);
}

export function retireAchievement(
  achievementId: string,
  request: RetireAchievementRequest,
  options: IdempotencyRequestOptions,
) {
  return apiRequest<ItemResponse>(
    `/api/achievements/items/${encodeURIComponent(achievementId)}/retire`,
    {
      method: "POST",
      body: request,
      idempotency: { key: options.idempotencyKey },
    },
  ).then(normalizeItem);
}

export function correctAchievementClaim(
  claimId: string,
  request: CorrectAchievementClaimRequest,
  options: IdempotencyRequestOptions,
) {
  return apiRequest<AchievementClaim>(`/api/achievements/claims/${encodeURIComponent(claimId)}`, {
    method: "PUT",
    body: request,
    idempotency: { key: options.idempotencyKey },
  });
}

export function addMatchAchievements(
  matchId: string,
  request: AddMatchAchievementsRequest,
  options: IdempotencyRequestOptions,
) {
  return apiRequest<AchievementSavedResponse>(
    `/api/matches/${encodeURIComponent(matchId)}/achievements`,
    {
      method: "POST",
      body: request,
      idempotency: { key: options.idempotencyKey },
    },
  );
}
