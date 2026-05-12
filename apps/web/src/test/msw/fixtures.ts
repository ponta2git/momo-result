import type { components } from "@/shared/api/generated";

export const now = "2026-01-01T00:00:00.000Z";

export type GameTitleRecord = components["schemas"]["GameTitleResponse"];
export type LoginAccountRecord = components["schemas"]["LoginAccountResponse"];
export type MapMasterRecord = components["schemas"]["MapMasterResponse"];
export type SeasonMasterRecord = components["schemas"]["SeasonMasterResponse"];
export type IncidentRecord = components["schemas"]["IncidentMasterResponse"];
export type MemberAliasRecord = components["schemas"]["MemberAliasResponse"];
export type MatchListEntry = components["schemas"]["MatchSummaryResponse"];

const gameTitlesSeed: readonly GameTitleRecord[] = [
  {
    createdAt: now,
    displayOrder: 1,
    id: "gt_momotetsu_2",
    layoutFamily: "momotetsu_2",
    name: "桃太郎電鉄2",
  },
];

const mapMastersSeed: readonly MapMasterRecord[] = [
  {
    createdAt: now,
    displayOrder: 1,
    gameTitleId: "gt_momotetsu_2",
    id: "map_east",
    name: "東日本編",
  },
];

const seasonMastersSeed: readonly SeasonMasterRecord[] = [
  {
    createdAt: now,
    displayOrder: 1,
    gameTitleId: "gt_momotetsu_2",
    id: "season_current",
    name: "今シーズン",
  },
];

const memberAliasesSeed: readonly MemberAliasRecord[] = [
  {
    alias: "NO11",
    createdAt: now,
    id: "alias-akane-mami-no11",
    memberId: "member_akane_mami",
  },
];

const loginAccountsSeed: readonly LoginAccountRecord[] = [
  {
    accountId: "account_ponta",
    createdAt: now,
    discordUserId: "523484457705930752",
    displayName: "ぽんた",
    isAdmin: true,
    loginEnabled: true,
    playerMemberId: "member_ponta",
    updatedAt: now,
  },
  {
    accountId: "account_eu",
    createdAt: now,
    discordUserId: "523484457705930755",
    displayName: "いーゆー",
    isAdmin: false,
    loginEnabled: true,
    playerMemberId: "member_eu",
    updatedAt: now,
  },
];

export const incidentMastersSeed: readonly IncidentRecord[] = [
  { displayName: "目的地", displayOrder: 1, id: "incident_destination", key: "destination" },
  { displayName: "プラス駅", displayOrder: 2, id: "incident_plus_station", key: "plusStation" },
  { displayName: "マイナス駅", displayOrder: 3, id: "incident_minus_station", key: "minusStation" },
  { displayName: "カード駅", displayOrder: 4, id: "incident_card_station", key: "cardStation" },
  { displayName: "カード売り場", displayOrder: 5, id: "incident_card_shop", key: "cardShop" },
  { displayName: "スリの銀次", displayOrder: 6, id: "incident_suri_no_ginji", key: "suriNoGinji" },
];

const playerField = (value: unknown, confidence = 0.96) => ({
  confidence,
  raw_text: value == null ? null : String(value),
  value,
  warnings: [],
});

export const draftPayload = {
  category_payload: {},
  detected_screen_type: "total_assets",
  players: [
    {
      incidents: {},
      member_id: "member_ponta",
      play_order: playerField(1),
      rank: playerField(1),
      raw_player_name: playerField("ぽんた"),
      revenue_man_yen: playerField(100),
      total_assets_man_yen: playerField(1000),
    },
  ],
  profile_id: "momotetsu_2.total_assets.v1",
  raw_snippets: null,
  requested_screen_type: "total_assets",
  warnings: [],
};

const matchListSeed: readonly MatchListEntry[] = [
  {
    createdAt: now,
    gameTitleId: "gt_momotetsu_2",
    heldEventId: "held-1",
    id: "draft-running-1",
    kind: "match_draft",
    mapMasterId: "map_east",
    matchDraftId: "draft-running-1",
    matchNoInEvent: 2,
    ownerMemberId: "member_ponta",
    playedAt: now,
    ranks: [],
    seasonMasterId: "season_current",
    status: "ocr_running",
    updatedAt: "2026-01-02T01:00:00.000Z",
  },
  {
    createdAt: now,
    gameTitleId: "gt_momotetsu_2",
    heldEventId: "held-1",
    id: "draft-review-1",
    kind: "match_draft",
    mapMasterId: "map_east",
    matchDraftId: "draft-review-1",
    matchNoInEvent: 3,
    ownerMemberId: "member_ponta",
    playedAt: now,
    ranks: [],
    seasonMasterId: "season_current",
    status: "needs_review",
    updatedAt: "2026-01-02T02:00:00.000Z",
  },
  {
    createdAt: now,
    gameTitleId: "gt_momotetsu_2",
    heldEventId: "held-1",
    id: "match-1",
    kind: "match",
    mapMasterId: "map_east",
    matchId: "match-1",
    matchNoInEvent: 1,
    ownerMemberId: "member_ponta",
    playedAt: now,
    ranks: [
      { memberId: "member_ponta", playOrder: 1, rank: 1 },
      { memberId: "member_akane_mami", playOrder: 2, rank: 2 },
      { memberId: "member_otaka", playOrder: 3, rank: 3 },
      { memberId: "member_eu", playOrder: 4, rank: 4 },
    ],
    seasonMasterId: "season_current",
    status: "confirmed",
    updatedAt: now,
  },
];

export const mswState = {
  gameTitles: structuredClone(gameTitlesSeed) as GameTitleRecord[],
  loginAccounts: structuredClone(loginAccountsSeed) as LoginAccountRecord[],
  mapMasters: structuredClone(mapMastersSeed) as MapMasterRecord[],
  matchList: structuredClone(matchListSeed) as MatchListEntry[],
  memberAliases: structuredClone(memberAliasesSeed) as MemberAliasRecord[],
  seasonMasters: structuredClone(seasonMastersSeed) as SeasonMasterRecord[],
};

export function resetMswStores(): void {
  mswState.gameTitles = structuredClone(gameTitlesSeed) as GameTitleRecord[];
  mswState.mapMasters = structuredClone(mapMastersSeed) as MapMasterRecord[];
  mswState.seasonMasters = structuredClone(seasonMastersSeed) as SeasonMasterRecord[];
  mswState.memberAliases = structuredClone(memberAliasesSeed) as MemberAliasRecord[];
  mswState.loginAccounts = structuredClone(loginAccountsSeed) as LoginAccountRecord[];
  mswState.matchList = structuredClone(matchListSeed) as MatchListEntry[];
}
