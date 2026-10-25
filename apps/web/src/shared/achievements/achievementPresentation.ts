import type { AchievementResource } from "@/shared/api/achievements";
import { formatDateTimeLong } from "@/shared/lib/dateTime";

export type PublishedAchievement = AchievementResource["items"][number];
export type AchievementDefinition = Omit<PublishedAchievement, "players" | "ruleKind"> & {
  ruleKind: string;
};
export type PublishedAchievementPlayer = PublishedAchievement["players"][number];
export type PublishedAchievementProof = PublishedAchievementPlayer["proofs"][number];

export const achievementRuleOptions = [
  { value: "manual", label: "手入力" },
  { value: "total_assets", label: "終了時の総資産" },
  { value: "destination", label: "目的地到着回数" },
  { value: "suri_no_ginji", label: "スリの銀次の回数" },
  { value: "event_average_rank", label: "1開催4試合の平均順位" },
] as const;

export function achievementStatusLabel(status: PublishedAchievementPlayer["status"]) {
  switch (status) {
    case "achieved":
      return "達成！";
    case "unconfirmed":
      return "確認待ち";
    case "not_recorded":
      return "まだ記録なし";
  }
}

export function achievementDateLabel(player: PublishedAchievementPlayer): string | null {
  if (player.status !== "achieved") return null;
  if (player.firstAchievedAt) {
    return formatDateTimeLong(player.firstAchievedAt);
  }
  return "日付の記録なし";
}

export function achievementPageHref(
  gameTitleId: string,
  achievementId?: string,
  memberId?: string,
) {
  const search = new URLSearchParams({ gameTitleId });
  if (achievementId) search.set("achievementId", achievementId);
  if (memberId) search.set("memberId", memberId);
  return `/achievements?${search.toString()}`;
}
