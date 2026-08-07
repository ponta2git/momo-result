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
