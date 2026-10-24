import type { AchievementResource } from "@/shared/api/achievements";
import { formatDateTimeLong } from "@/shared/lib/dateTime";

export type PublishedAchievement = AchievementResource["items"][number];
export type PublishedAchievementPlayer = PublishedAchievement["players"][number];
export type PublishedAchievementProof = PublishedAchievementPlayer["proofs"][number];

const achievementNameOrder = new Intl.Collator("ja", { numeric: true });
const ruleOrder = ["total_assets", "destination", "suri_no_ginji", "event_average_rank", "manual"];

function thresholdOrder(item: Pick<PublishedAchievement, "threshold">) {
  return item.threshold === null ? Number.POSITIVE_INFINITY : Number(item.threshold);
}

/** Keep all achievement lists in a meaningful order without depending on storage identifiers. */
export function orderAchievementItems<
  T extends Pick<
    PublishedAchievement,
    "achievementId" | "name" | "common" | "mapMasterIds" | "threshold"
  > & { ruleKind: string },
>(items: readonly T[], maps: ReadonlyArray<AchievementResource["maps"][number]>): T[] {
  const names = new Map(maps.map((map) => [map.mapMasterId, map.displayName]));
  const mapLabel = (item: T) =>
    item.mapMasterIds
      .map((id) => names.get(id) ?? id)
      .toSorted(achievementNameOrder.compare)
      .join("・");
  return items.toSorted(
    (left, right) =>
      Number(left.common) - Number(right.common) ||
      achievementNameOrder.compare(mapLabel(left), mapLabel(right)) ||
      ruleOrder.indexOf(left.ruleKind) - ruleOrder.indexOf(right.ruleKind) ||
      thresholdOrder(left) - thresholdOrder(right) ||
      achievementNameOrder.compare(left.name, right.name) ||
      left.achievementId.localeCompare(right.achievementId),
  );
}

export const achievementRuleOptions = [
  { value: "manual", label: "手入力" },
  { value: "total_assets", label: "終了時の総資産が閾値以上" },
  { value: "destination", label: "目的地到着回数が閾値以上" },
  { value: "suri_no_ginji", label: "スリの銀次の回数が閾値以上" },
  { value: "event_average_rank", label: "1開催4試合の平均順位が閾値以下" },
] as const;

export function achievementStatusLabel(status: PublishedAchievementPlayer["status"]) {
  switch (status) {
    case "achieved":
      return "達成済み";
    case "unconfirmed":
      return "移行元で未確認";
    case "not_recorded":
      return "達成記録なし";
  }
}

export function achievementDateLabel(player: PublishedAchievementPlayer): string | null {
  if (player.status !== "achieved") return null;
  if (player.firstAchievedAt) {
    return `${player.dateUnknown ? "記録上 " : ""}${formatDateTimeLong(player.firstAchievedAt)}`;
  }
  return "日時不明";
}

export function achievementProofLabel(kind: PublishedAchievementProof["kind"]): string {
  switch (kind) {
    case "manual":
      return "手入力";
    case "import":
      return "移行時の申告";
    case "derived":
      return "上位実績からの補完";
    case "automatic":
      return "試合結果による判定";
  }
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
