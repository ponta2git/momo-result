import { formatMatchNoInEvent } from "@/shared/domain/matchLabels";
import { formatDateTimeCompact, formatDateTimeLong } from "@/shared/lib/dateTime";

export function formatDateTime(iso: string | undefined): string {
  return formatDateTimeLong(iso, "未設定");
}

export function formatCompactDateTime(iso: string | undefined): string {
  return formatDateTimeCompact(iso);
}

export function formatMatchNo(matchNoInEvent: number | undefined): string {
  return formatMatchNoInEvent(matchNoInEvent);
}

export function formatGameSeason(
  gameTitleName: string | undefined,
  seasonName: string | undefined,
): string {
  return [gameTitleName, seasonName].filter(Boolean).join(" ") || "作品/シーズン未設定";
}
