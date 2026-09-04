import { sanitizeReturnTo, withReturnTo } from "@/shared/navigation/returnTo";
import { PageLoadingFallback } from "@/shared/ui/feedback/PageLoadingFallback";
import type {
  PageLoadingContentToolbarShape,
  PageLoadingFallbackProps,
  PageLoadingHeaderShape,
} from "@/shared/ui/feedback/PageLoadingFallback";
import type { PageContentSurfacePadding } from "@/shared/ui/layout/PageContentSurface";
import type { PageFrameWidth } from "@/shared/ui/layout/PageFrame";
import type { PageHeaderDescriptionStatus } from "@/shared/ui/layout/PageHeader";
import { appendHandoffIdToReturnTo } from "@/shared/workflows/matchWorkspaceMasterHandoff";
import { workspaceSampleStatus } from "@/shared/workflows/matchWorkspacePresentation";

type RouteSuspenseFallbackProps = {
  asMain?: boolean | undefined;
  loadingLabel?: string | undefined;
  pathname: string;
  search?: string | undefined;
};

type RouteLoadingPresentation = {
  contentToolbar?: PageLoadingContentToolbarShape | undefined;
  contextNoticeSlot?: boolean;
  header?: PageLoadingHeaderShape | undefined;
  kind: NonNullable<PageLoadingFallbackProps["kind"]>;
  leadingActionSlot?: boolean;
  loadingLabel?: PageLoadingFallbackProps["loadingLabel"];
  width: PageFrameWidth;
};

export type RouteNavigationPresentation = {
  href: string;
  icon?: "back" | undefined;
  label: string;
};

export type RouteHeaderActionPresentation = Omit<RouteNavigationPresentation, "icon"> & {
  icon?: "download" | "filter" | "manual" | "scan" | undefined;
  size?: "md" | "sm" | undefined;
  variant?: "quiet" | "secondary" | undefined;
};

type RouteHeaderActionsPresentationBase = {
  items: readonly RouteHeaderActionPresentation[];
};

export type RouteHeaderActionsPresentation = RouteHeaderActionsPresentationBase &
  (
    | {
        label: string;
        layout: "responsive-grid" | "responsive-lead";
        semantics: "navigation";
      }
    | {
        label?: string | undefined;
        layout?: "inline" | "responsive-grid" | "responsive-lead" | undefined;
        semantics?: "group" | undefined;
      }
  );

export type RouteTerminalPresentation = {
  contentPadding: PageContentSurfacePadding;
  contextNavigation?: RouteNavigationPresentation | undefined;
  description?: string | undefined;
  descriptionStatus?: PageHeaderDescriptionStatus | undefined;
  eyebrow?: string | undefined;
  headerActions?: RouteHeaderActionsPresentation | undefined;
  headerNavigation?: RouteNavigationPresentation | undefined;
  leadingNavigation?: RouteNavigationPresentation | undefined;
  preserveHeader?: boolean | undefined;
  width: PageFrameWidth;
};

type RoutePagePresentation = {
  loading: RouteLoadingPresentation;
  terminal: RouteTerminalPresentation;
};

function decodeRouteSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function defineRoutePresentation(
  loading: RouteLoadingPresentation,
  terminal: Omit<RouteTerminalPresentation, "contentPadding" | "width"> & {
    contentPadding?: PageContentSurfacePadding;
  } = {},
): RoutePagePresentation {
  return {
    loading,
    terminal: {
      ...terminal,
      contentPadding: terminal.contentPadding ?? "default",
      width: loading.width,
    },
  };
}

/** Keeps pathname-to-layout knowledge in one app-layer owner for every route state. */
export function routePagePresentation(pathname: string, search = ""): RoutePagePresentation {
  const normalizedPathname = pathname.replace(/\/+$/u, "") || "/";
  const searchParams = new URLSearchParams(search);
  const normalizedSearch = searchParams.size > 0 ? `?${searchParams.toString()}` : "";
  const routeLocation = `${normalizedPathname}${normalizedSearch}`;
  const returnTo = sanitizeReturnTo(searchParams.get("returnTo"));
  const hasReturnTo = Boolean(returnTo);

  if (normalizedPathname === "/matches") {
    return defineRoutePresentation(
      {
        contentToolbar: {
          actionLayout: "responsive-grid",
          actionSize: "sm",
          actionSlots: 2,
          actionWidths: ["standard", "wide"],
        },
        kind: "list",
        leadingActionSlot: hasReturnTo,
        width: "standard",
      },
      {
        headerActions: {
          items: [
            {
              href: withReturnTo("/ocr/new", routeLocation),
              icon: "scan",
              label: "OCR取り込み",
              size: "sm",
            },
            {
              href: withReturnTo("/matches/new", routeLocation),
              icon: "manual",
              label: "手入力で作成",
              size: "sm",
            },
          ],
          label: "試合を登録",
          layout: "responsive-grid",
        },
        leadingNavigation: returnTo ? { href: returnTo, label: "前の画面へ戻る" } : undefined,
      },
    );
  }
  if (normalizedPathname === "/held-events") {
    return defineRoutePresentation({
      kind: "record-list",
      width: "standard",
    });
  }
  if (normalizedPathname === "/admin/accounts") {
    return defineRoutePresentation({ kind: "record-list", width: "standard" });
  }
  if (normalizedPathname === "/matches/new") {
    return defineRoutePresentation(
      {
        contentToolbar: {
          actionSize: "sm",
          actionSlots: 1,
          actionWidths: ["long"],
        },
        kind: "workspace",
        width: "workspace",
      },
      {
        headerNavigation: {
          href: returnTo ?? "/matches",
          label: "入力をやめる",
        },
      },
    );
  }
  if (/^\/review\/[^/]+$/u.test(normalizedPathname)) {
    const descriptionStatus =
      searchParams.get("sample") === "1" ? workspaceSampleStatus : undefined;
    return defineRoutePresentation(
      {
        contentToolbar: {
          actionSize: "sm",
          actionSlots: 1,
          actionWidths: ["long"],
          status: descriptionStatus,
        },
        kind: "workspace",
        width: "workspace",
      },
      {
        descriptionStatus,
        headerNavigation: {
          href: returnTo ?? "/matches",
          label: "入力をやめる",
        },
      },
    );
  }
  if (/^\/matches\/[^/]+\/edit$/u.test(normalizedPathname)) {
    return defineRoutePresentation(
      {
        contentToolbar: {
          actionSize: "sm",
          actionSlots: 1,
          actionWidths: ["long"],
        },
        kind: "workspace",
        width: "workspace",
      },
      {
        headerNavigation: {
          href: returnTo ?? normalizedPathname.slice(0, -"/edit".length),
          label: "編集をやめる",
        },
      },
    );
  }
  if (normalizedPathname === "/ocr/new") {
    return defineRoutePresentation(
      {
        contentToolbar: hasReturnTo
          ? {
              actionSize: "sm",
              actionSlots: 1,
              actionWidths: ["wide"],
            }
          : undefined,
        kind: "workspace",
        width: "standard",
      },
      {
        headerNavigation: returnTo
          ? { href: returnTo, icon: "back", label: "取り込みをやめる" }
          : undefined,
      },
    );
  }
  if (/^\/matches\/[^/]+$/u.test(normalizedPathname)) {
    return defineRoutePresentation(
      {
        header: {
          actionSize: "md",
          actionSlots: 2,
          actionWidths: ["long", "short"],
          description: false,
          eyebrow: false,
        },
        kind: "detail",
        leadingActionSlot: true,
        width: "wide",
      },
      {
        headerActions: {
          items: [
            {
              href: withReturnTo(
                `/exports?${new URLSearchParams({
                  matchId: decodeRouteSegment(normalizedPathname.slice("/matches/".length)),
                }).toString()}`,
                routeLocation,
              ),
              label: "この試合を出力",
            },
            {
              href: withReturnTo(`${normalizedPathname}/edit`, routeLocation),
              label: "編集",
            },
          ],
        },
        leadingNavigation: {
          href: returnTo ?? "/matches",
          label: "前の画面へ戻る",
        },
        preserveHeader: true,
      },
    );
  }
  if (/^\/held-events\/[^/]+$/u.test(normalizedPathname)) {
    const heldEventId = decodeRouteSegment(normalizedPathname.slice("/held-events/".length));
    const matchesParams = new URLSearchParams({ heldEventId, sort: "match_no_asc" });
    const exportParams = new URLSearchParams({ heldEventId, format: "csv" });
    return defineRoutePresentation(
      {
        header: {
          actionLayout: "responsive-lead",
          actionSize: "sm",
          actionSlots: 2,
          actionWidths: ["wide", "standard"],
          description: true,
          eyebrow: true,
        },
        kind: "detail",
        leadingActionSlot: true,
        width: "wide",
      },
      {
        description: "試合数・下書き数は未取得です。",
        eyebrow: "開催記録",
        headerActions: {
          items: [
            {
              href: withReturnTo(`/matches?${matchesParams.toString()}`, routeLocation),
              icon: "filter",
              label: "試合検索で見る",
              size: "sm",
              variant: "quiet",
            },
            {
              href: withReturnTo(`/exports?${exportParams.toString()}`, routeLocation),
              icon: "download",
              label: "CSV出力",
              size: "sm",
              variant: "quiet",
            },
          ],
          label: "この開催の関連操作",
          layout: "responsive-lead",
          semantics: "navigation",
        },
        leadingNavigation: {
          href: returnTo ?? "/held-events",
          label: "開催履歴へ戻る",
        },
        preserveHeader: true,
      },
    );
  }
  if (normalizedPathname === "/analytics/series") {
    return defineRoutePresentation(
      {
        contentToolbar: hasReturnTo
          ? {
              actionSize: "sm",
              actionSlots: 1,
              actionWidths: ["wide"],
            }
          : undefined,
        kind: "comparison",
        loadingLabel: "戦績比較を読み込んでいます",
        width: "wide",
      },
      {
        headerNavigation: returnTo
          ? { href: returnTo, icon: "back", label: "前の画面へ戻る" }
          : undefined,
      },
    );
  }
  if (normalizedPathname === "/admin/analysis") {
    return defineRoutePresentation({
      kind: "sectioned-comparison",
      loadingLabel: "戦績分析管理を読み込んでいます",
      width: "wide",
    });
  }
  if (normalizedPathname === "/admin/masters") {
    const handoffId = searchParams.get("handoffId");
    const returnDestination =
      returnTo && handoffId ? appendHandoffIdToReturnTo(returnTo, handoffId) : returnTo;
    return defineRoutePresentation(
      {
        contextNoticeSlot: hasReturnTo,
        kind: "catalog",
        loadingLabel: "設定管理を読み込んでいます",
        width: "standard",
      },
      {
        contextNavigation: returnDestination
          ? { href: returnDestination, label: "元の画面へ戻る" }
          : undefined,
      },
    );
  }
  if (normalizedPathname === "/exports") {
    return defineRoutePresentation(
      {
        kind: "form",
        leadingActionSlot: hasReturnTo,
        width: "narrow",
      },
      {
        contentPadding: "compact",
        leadingNavigation: returnTo ? { href: returnTo, label: "前の画面へ戻る" } : undefined,
      },
    );
  }
  return defineRoutePresentation({
    kind: "generic",
    width: "standard",
  });
}

export function routeLoadingPresentation(pathname: string, search = ""): RouteLoadingPresentation {
  return routePagePresentation(pathname, search).loading;
}

export function routeTerminalPresentation(
  pathname: string,
  search = "",
): RouteTerminalPresentation {
  return routePagePresentation(pathname, search).terminal;
}

/** Keeps terminal route states aligned with the ready/loading page width. */
export function routeFrameWidth(pathname: string): PageFrameWidth {
  return routeLoadingPresentation(pathname).width;
}

export function RouteSuspenseFallback({
  asMain = false,
  loadingLabel,
  pathname,
  search = "",
}: RouteSuspenseFallbackProps) {
  const presentation = routeLoadingPresentation(pathname, search);
  return (
    <PageLoadingFallback
      asMain={asMain}
      {...presentation}
      loadingLabel={loadingLabel ?? presentation.loadingLabel}
    />
  );
}
