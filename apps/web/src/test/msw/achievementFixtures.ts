import type {
  AchievementCatalog,
  AchievementClaim,
  AchievementItem,
  AchievementResource,
} from "@/shared/api/achievements";
import { canonicalResultMembers } from "@/shared/domain/members";
import { analysisArtifact } from "@/test/msw/seriesAnalysisFixtures";

export function makeAchievementItem(overrides: Partial<AchievementItem> = {}): AchievementItem {
  return {
    achievementId: "achievement-manual",
    gameTitleId: "gt_momotetsu_2",
    name: "手入力のテスト実績",
    notes: "条件を確認して入力します。",
    common: true,
    mapMasterIds: [],
    ruleKind: "manual",
    threshold: null,
    stars: 2,
    sortOrder: 0,
    appliesFrom: null,
    retiredAt: null,
    version: "1",
    ...overrides,
  };
}

export function makeAchievementClaim(overrides: Partial<AchievementClaim> = {}): AchievementClaim {
  return {
    claimId: "claim-direct",
    achievementId: "achievement-manual",
    memberId: "member_ponta",
    sourceKind: "direct",
    state: "achieved",
    matchId: null,
    achievedAt: "2026-04-04T12:34:56.000Z",
    generationId: "generation-1",
    version: "2",
    updatedByDisplayName: "テスト記録者",
    updatedAt: "2026-04-05T12:00:00.000Z",
    ...overrides,
  };
}

export function makeAchievementCatalog(
  overrides: Partial<AchievementCatalog> = {},
): AchievementCatalog {
  return {
    gameTitleId: "gt_momotetsu_2",
    orderRevision: "0".repeat(64),
    items: [],
    claims: [],
    members: canonicalResultMembers.map(({ memberId, displayName }) => ({ memberId, displayName })),
    maps: [
      { mapMasterId: "map_east", displayName: "東日本編" },
      { mapMasterId: "map_empty", displayName: "新しいマップ" },
    ],
    ...overrides,
  };
}

export function makeAchievementResource(
  overrides: Partial<AchievementResource> = {},
): AchievementResource {
  return {
    schemaVersion: 2,
    scope: { kind: "overall", displayName: "作品通算" },
    gameTitleId: "gt_momotetsu_2",
    achievementCurve: { thresholds: [0, 10, 25, 50, 80] },
    artifact: analysisArtifact,
    items: [],
    summaries: [null, "map_east", "map_empty"].map((mapMasterId) => ({
      mapMasterId,
      totalPoints: 0,
      players: canonicalResultMembers.map(({ memberId, displayName }) => ({
        memberId,
        displayName,
        earnedPoints: 0,
        score: null,
      })) as AchievementResource["summaries"][number]["players"],
    })),
    maps: makeAchievementCatalog().maps,
    ...overrides,
  };
}

export function makeAchievedResource(): AchievementResource {
  const item = makeAchievementItem();
  const resource = makeAchievementResource();
  resource.items = [
    {
      achievementId: item.achievementId,
      name: item.name,
      notes: item.notes,
      stars: item.stars,
      ruleKind: "manual",
      threshold: null,
      common: true,
      mapMasterIds: [],
      appliesFrom: item.appliesFrom,
      retired: false,
      players: canonicalResultMembers.map(({ memberId, displayName }) => ({
        memberId,
        displayName,
        status: memberId === "member_ponta" ? "achieved" : "not_recorded",
        firstAchievedAt: null,
        dateUnknown: memberId === "member_ponta",
        proofs:
          memberId === "member_ponta"
            ? [
                {
                  kind: "manual",
                  state: "achieved",
                  claimId: "claim-direct",
                  generationId: "generation-1",
                  sourceAchievementId: null,
                  matchId: null,
                  heldEventId: null,
                  achievedAt: null,
                  matchAvailable: false,
                  heldEventAvailable: false,
                },
              ]
            : [],
      })) as AchievementResource["items"][number]["players"],
    },
  ];
  resource.summaries = resource.summaries.map((summary) => ({
    ...summary,
    totalPoints: 4,
    players: summary.players.map((player) => ({
      ...player,
      earnedPoints: player.memberId === "member_ponta" ? 4 : 0,
      score: player.memberId === "member_ponta" ? 10 : 1,
    })) as AchievementResource["summaries"][number]["players"],
  }));
  return resource;
}
