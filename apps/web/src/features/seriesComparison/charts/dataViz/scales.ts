export function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function niceCeil(value: number, minimumStep: number): number {
  if (!Number.isFinite(value) || value <= 0) return minimumStep;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return Math.max(minimumStep, nice * magnitude);
}

export function numberTicks(
  minimum: number,
  maximum: number,
  targetCount: number,
  minimumStep: number,
): number[] {
  const span = Math.max(minimumStep, maximum - minimum);
  const step = niceCeil(span / Math.max(1, targetCount - 1), minimumStep);
  const start = Math.floor(minimum / step) * step;
  const end = Math.ceil(maximum / step) * step;
  const ticks: number[] = [];
  for (let value = start; value <= end + step / 2; value += step) {
    ticks.push(Number(value.toPrecision(12)));
  }
  return ticks;
}

export function indexTicks(maximum: number, targetCount: number): number[] {
  if (maximum <= 1) return [1];
  const step = Math.max(1, Math.ceil((maximum - 1) / Math.max(1, targetCount - 1)));
  const ticks: number[] = [];
  for (let value = 1; value <= maximum; value += step) ticks.push(value);
  if (ticks.at(-1) !== maximum) ticks.push(maximum);
  return ticks;
}
