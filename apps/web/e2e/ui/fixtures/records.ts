/** Stable browser-owned identities; no service setup or writes are performed. */
export const confirmedContext = {
  gameTitleId: "gt_momotetsu_2",
  gameTitleName: "桃太郎電鉄2",
  mapMasterId: "map_east",
  mapName: "東日本編",
  seasonMasterId: "season_current",
  seasonName: "今シーズン",
  heldEventId: "held-1",
  matchId: "match-1",
} as const;

export const confirmedMatchIds = ["match-1", "match-2"] as const;
