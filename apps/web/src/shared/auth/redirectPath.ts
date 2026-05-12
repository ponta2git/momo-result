const appOrigin = "https://momo-result.local";

export function currentAppPath(pathname: string, search: string, hash: string): string {
  return `${pathname}${search}${hash}`;
}

export function sanitizeAppRedirectPath(value: string | null | undefined): string | undefined {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return undefined;
  }

  try {
    const parsed = new URL(value, appOrigin);
    if (parsed.origin !== appOrigin) {
      return undefined;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return undefined;
  }
}

export function buildLoginPath(nextPath: string): string {
  const safeNext = sanitizeAppRedirectPath(nextPath);
  if (!safeNext) {
    return "/login";
  }
  const params = new URLSearchParams({ next: safeNext });
  return `/login?${params.toString()}`;
}

export function buildAuthLoginHref(nextPath: string | undefined): string {
  const safeNext = sanitizeAppRedirectPath(nextPath);
  if (!safeNext) {
    return "/api/auth/login?silent=1";
  }
  const params = new URLSearchParams({ next: safeNext, silent: "1" });
  return `/api/auth/login?${params.toString()}`;
}
