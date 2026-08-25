const defaultMatchNoInEventFallback = "試合番号未設定";
const defaultSeriesMatchIndexFallback = "対戦順未設定";

function isPositiveSafeInteger(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/**
 * 開催内の `matchNoInEvent` を「第N試合」と表示する。
 * 比較スコープ内の通算順には使わず、値が正の整数でなければ明示したfallbackを返す。
 */
export function formatMatchNoInEvent(
  value: number | null | undefined,
  fallback = defaultMatchNoInEventFallback,
): string {
  return isPositiveSafeInteger(value) ? `第${value}試合` : fallback;
}

/**
 * 比較スコープ内の通算順 `matchIndex` を「第N戦」と表示する。
 * 開催内の試合番号には使わず、値が正の整数でなければ明示したfallbackを返す。
 */
export function formatSeriesMatchIndex(
  value: number | null | undefined,
  fallback = defaultSeriesMatchIndexFallback,
): string {
  return isPositiveSafeInteger(value) ? `第${value}戦` : fallback;
}
