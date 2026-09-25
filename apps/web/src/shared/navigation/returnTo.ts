export function sanitizeReturnTo(value: string | null | undefined): string | undefined {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return undefined;
  }

  try {
    const parsed = new URL(value, "https://momo-result.local");
    if (parsed.origin !== "https://momo-result.local") {
      return undefined;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return undefined;
  }
}

export function withReturnTo(destination: string, returnTo: string | undefined): string {
  const safeReturnTo = sanitizeReturnTo(returnTo);
  if (!safeReturnTo) {
    return destination;
  }
  const parsed = new URL(destination, "https://momo-result.local");
  if (parsed.origin !== "https://momo-result.local") {
    return destination;
  }
  parsed.searchParams.set("returnTo", safeReturnTo);
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export function currentInternalLocation(location: {
  hash?: string;
  pathname: string;
  search?: string;
}): string {
  return `${location.pathname}${location.search ?? ""}${location.hash ?? ""}`;
}

export type ReturnDestination =
  | { kind: "none" }
  | { kind: "matchList" }
  | { kind: "matchDetail"; matchId: string }
  | { kind: "heldEventList" }
  | { kind: "heldEventDetail"; heldEventId: string }
  | { kind: "seriesComparison" }
  | { kind: "internal" };

/** Classifies route identity without confusing a detail or editor with its parent list. */
export function classifyReturnTo(value: string | null | undefined): ReturnDestination {
  const safe = sanitizeReturnTo(value);
  if (!safe) return { kind: "none" };
  const pathname = new URL(safe, "https://momo-result.local").pathname;
  if (/^\/matches\/?$/u.test(pathname)) return { kind: "matchList" };
  if (/^\/held-events\/?$/u.test(pathname)) return { kind: "heldEventList" };
  if (/^\/analytics\/series\/?$/u.test(pathname)) return { kind: "seriesComparison" };
  const match = /^\/matches\/([^/]+)\/?$/u.exec(pathname);
  const heldEvent = /^\/held-events\/([^/]+)\/?$/u.exec(pathname);
  try {
    if (match?.[1]) {
      const matchId = decodeURIComponent(match[1]);
      if (matchId !== "new") return { kind: "matchDetail", matchId };
    }
    if (heldEvent?.[1]) {
      return { kind: "heldEventDetail", heldEventId: decodeURIComponent(heldEvent[1]) };
    }
  } catch {
    // An invalid encoded identifier is still an internal URL, not a known resource identity.
  }
  return { kind: "internal" };
}

/** Query, fragment and encoded spelling cannot turn the current resource into a return target. */
export function isSameResourceReturnTo(
  returnTo: string | null | undefined,
  currentPath: string,
): boolean {
  const target = classifyReturnTo(returnTo);
  const current = classifyReturnTo(currentPath);
  if (target.kind === "matchDetail" && current.kind === "matchDetail") {
    return target.matchId === current.matchId;
  }
  return (
    target.kind === "heldEventDetail" &&
    current.kind === "heldEventDetail" &&
    target.heldEventId === current.heldEventId
  );
}
