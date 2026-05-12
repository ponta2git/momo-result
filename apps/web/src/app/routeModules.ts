export const loadAdminAccountsPage = () =>
  import("@/features/adminAccounts/AdminAccountsPage").then((module) => ({
    default: module.AdminAccountsPage,
  }));

export const loadLoginPage = () =>
  import("@/features/auth/LoginPage").then((module) => ({ default: module.LoginPage }));

export const loadDraftReviewPage = () =>
  import("@/features/matches/workspace/DraftReviewPage").then((module) => ({
    default: module.DraftReviewPage,
  }));

export const loadExportPage = () =>
  import("@/features/exports/ExportPage").then((module) => ({ default: module.ExportPage }));

export const loadHeldEventsPage = () =>
  import("@/features/heldEvents/HeldEventsPage").then((module) => ({
    default: module.HeldEventsPage,
  }));

export const loadMastersPage = () =>
  import("@/features/masters/MastersPage").then((module) => ({ default: module.MastersPage }));

export const loadMatchCreatePage = () =>
  import("@/features/matches/MatchCreatePage").then((module) => ({
    default: module.MatchCreatePage,
  }));

export const loadMatchDetailPage = () =>
  import("@/features/matches/MatchDetailPage").then((module) => ({
    default: module.MatchDetailPage,
  }));

export const loadMatchesListPage = () =>
  import("@/features/matches/MatchesListPage").then((module) => ({
    default: module.MatchesListPage,
  }));

export const loadMatchEditPage = () =>
  import("@/features/matches/MatchEditPage").then((module) => ({
    default: module.MatchEditPage,
  }));

export const loadOcrCapturePage = () =>
  import("@/features/ocrCapture/OcrCapturePage").then((module) => ({
    default: module.OcrCapturePage,
  }));

const routePreloaders: Array<{
  matches: (pathname: string) => boolean;
  preload: () => Promise<unknown>;
}> = [
  { matches: (pathname) => pathname === "/login", preload: loadLoginPage },
  { matches: (pathname) => pathname === "/matches", preload: loadMatchesListPage },
  { matches: (pathname) => pathname === "/held-events", preload: loadHeldEventsPage },
  { matches: (pathname) => pathname === "/matches/new", preload: loadMatchCreatePage },
  { matches: (pathname) => /^\/matches\/[^/]+\/edit$/u.test(pathname), preload: loadMatchEditPage },
  { matches: (pathname) => /^\/matches\/[^/]+$/u.test(pathname), preload: loadMatchDetailPage },
  { matches: (pathname) => pathname === "/ocr/new", preload: loadOcrCapturePage },
  { matches: (pathname) => /^\/review\/[^/]+$/u.test(pathname), preload: loadDraftReviewPage },
  { matches: (pathname) => pathname === "/exports", preload: loadExportPage },
  { matches: (pathname) => pathname === "/admin/masters", preload: loadMastersPage },
  { matches: (pathname) => pathname === "/admin/accounts", preload: loadAdminAccountsPage },
];

function normalizePreloadPath(pathname: string): string {
  const withoutTrailingSlash = pathname.replace(/\/+$/u, "");
  return withoutTrailingSlash || "/";
}

export function preloadRouteForPath(pathname: string): void {
  const normalizedPath = normalizePreloadPath(pathname);
  const route = routePreloaders.find((candidate) => candidate.matches(normalizedPath));
  if (!route) {
    return;
  }
  void route.preload();
}
