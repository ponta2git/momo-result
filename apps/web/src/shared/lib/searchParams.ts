export function parsePositiveIntSearchParam(value: string | null, fallback: number): number {
  if (!value || !/^\d+$/u.test(value)) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : fallback;
}
