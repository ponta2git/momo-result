export function formatDateTime(iso: string | undefined): string {
  if (!iso) {
    return "未設定";
  }

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }

  return new Intl.DateTimeFormat("ja-JP", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

export function formatCompactDateTime(iso: string | undefined): string {
  if (!iso) {
    return "日時未設定";
  }

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }

  return new Intl.DateTimeFormat("ja-JP", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
  }).format(date);
}

export function formatMatchNo(matchNoInEvent: number | undefined): string {
  return matchNoInEvent ? `第${matchNoInEvent}試合` : "試合番号未設定";
}

export function formatGameSeason(
  gameTitleName: string | undefined,
  seasonName: string | undefined,
): string {
  return [gameTitleName, seasonName].filter(Boolean).join(" ") || "作品/シーズン未設定";
}
