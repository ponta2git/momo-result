

export function medianNumber(values: number[]): number | undefined {
  const sorted = values.toSorted((a, b) => a - b);
  if (sorted.length === 0) {
    return undefined;
  }
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

export function formatCompactManYen(value: number): string {
  if (value === 0) {
    return "0";
  }
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 10000) {
    return `${sign}${formatCompactNumber(abs / 10000)}億`;
  }
  return `${value}万`;
}

export function formatCompactNumber(value: number): string {
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
}

export function buildNumberTicks(
  minValue: number,
  maxValue: number,
  maxTickCount: number,
  minStep = 0,
): number[] {
  const span = Math.max(Number.EPSILON, maxValue - minValue);
  const rawStep = span / Math.max(1, maxTickCount - 1);
  const step = niceStep(rawStep, minStep);
  const first = Math.ceil(minValue / step) * step;
  const ticks: number[] = [];
  for (let value = first; value <= maxValue + step * 0.001; value += step) {
    ticks.push(Number(value.toFixed(4)));
  }
  if (!ticks.includes(minValue)) {
    ticks.unshift(minValue);
  }
  if (!ticks.includes(maxValue)) {
    ticks.push(maxValue);
  }
  return Array.from(new Set(ticks)).toSorted((a, b) => a - b);
}

export function buildIndexTicks(maxIndex: number, maxTickCount: number): number[] {
  if (maxIndex <= 1) {
    return [1];
  }
  const step = niceStep((maxIndex - 1) / Math.max(1, maxTickCount - 1), 1);
  const ticks = [1];
  for (let value = Math.ceil(2 / step) * step; value < maxIndex; value += step) {
    ticks.push(value);
  }
  ticks.push(maxIndex);
  return Array.from(new Set(ticks.map((value) => Math.round(value)))).toSorted((a, b) => a - b);
}

export function niceCeil(value: number, minStep = 0): number {
  const step = niceStep(value / 4, minStep);
  return Math.max(step, Math.ceil(value / step) * step);
}

export function niceStep(rawStep: number, minStep = 0): number {
  const safeStep = Math.max(rawStep, Number.EPSILON);
  const magnitude = 10 ** Math.floor(Math.log10(safeStep));
  const normalized = safeStep / magnitude;
  const factor =
    normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
  return Math.max(factor * magnitude, minStep);
}
