import type { LayoutFamily } from "@/shared/api/enums";

export type GameTitleId = "momotetsu_2" | "world" | "reiwa";

export type GameTitle = {
  id: GameTitleId;
  displayName: string;
  layoutFamily: LayoutFamily;
  maps: string[];
  computerPlayerAliases: string[];
};

export type Season = {
  id: string;
  displayName: string;
};

export type FixedMember = {
  memberId: string;
  displayName: string;
  aliases: string[];
};

export const gameTitles: GameTitle[] = [
  {
    id: "momotetsu_2",
    displayName: "桃太郎電鉄2",
    layoutFamily: "momotetsu_2",
    maps: ["東日本編", "西日本編"],
    computerPlayerAliases: [],
  },
  {
    id: "world",
    displayName: "桃太郎電鉄ワールド",
    layoutFamily: "world",
    maps: ["いつもの", "特別"],
    computerPlayerAliases: [],
  },
  {
    id: "reiwa",
    displayName: "桃太郎電鉄 ～昭和 平成 令和も定番！～",
    layoutFamily: "reiwa",
    maps: ["いつもの"],
    computerPlayerAliases: ["さくま"],
  },
];

export const seasons: Season[] = [
  { id: "season-current", displayName: "今シーズン" },
  { id: "season-archive", displayName: "過去シーズン" },
];

export const fixedMembers: FixedMember[] = [
  { memberId: "ponta", displayName: "ぽんた", aliases: ["ぽんた"] },
  { memberId: "akane-mami", displayName: "あかねまみ", aliases: ["あかねまみ", "NO11社長"] },
  { memberId: "otaka", displayName: "おーたか", aliases: ["おーたか", "オータカ社長"] },
  { memberId: "eu", displayName: "いーゆー", aliases: ["いーゆー", "いーゆー社長"] },
];

export function findGameTitle(gameTitleId: GameTitleId): GameTitle {
  const gameTitle = gameTitles.find((candidate) => candidate.id === gameTitleId);
  if (!gameTitle) {
    throw new Error(`Unknown game title: ${gameTitleId}`);
  }
  return gameTitle;
}
