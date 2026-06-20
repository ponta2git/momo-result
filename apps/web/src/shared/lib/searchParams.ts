export function parsePositiveIntSearchParam(value: string | null, fallback: number): number {
  if (!value || !/^\d+$/u.test(value)) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : fallback;
}

export function trimSearchParam(value: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
