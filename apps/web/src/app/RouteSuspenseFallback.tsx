import { sanitizeReturnTo, withReturnTo } from "@/shared/navigation/returnTo";
import { PageLoadingFallback } from "@/shared/ui/feedback/PageLoadingFallback";
import type {
  PageLoadingFallbackProps,
  PageLoadingHeaderShape,
} from "@/shared/ui/feedback/PageLoadingFallback";
import type { PageContentSurfacePadding } from "@/shared/ui/layout/PageContentSurface";
import type { PageFrameWidth } from "@/shared/ui/layout/PageFrame";
import { appendHandoffIdToReturnTo } from "@/shared/workflows/matchWorkspaceMasterHandoff";

type RouteSuspenseFallbackProps = {
  asMain?: boolean | undefined;
  loadingLabel?: string | undefined;
  pathname: string;
  search?: string | undefined;
};

type RouteLoadingPresentation = {
  contextNoticeSlot?: boolean;
  header: PageLoadingHeaderShape;
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
  icon?: "manual" | "scan" | undefined;
  size?: "md" | "sm" | undefined;
};

export type RouteHeaderActionsPresentation = {
  items: readonly RouteHeaderActionPresentation[];
  label?: string | undefined;
  layout?: "inline" | "responsive-grid" | undefined;
};

export type RouteTerminalPresentation = {
  contentPadding: PageContentSurfacePadding;
  contextNavigation?: RouteNavigationPresentation | undefined;
  description?: string | undefined;
  eyebrow?: string | undefined;
  headerActions?: RouteHeaderActionsPresentation | undefined;
  headerNavigation?: RouteNavigationPresentation | undefined;
  leadingNavigation?: RouteNavigationPresentation | undefined;
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
        header: {
          actionLayout: "responsive-grid",
          actionSize: "sm",
          actionSlots: 2,
          actionWidths: ["standard", "wide"],
          description: false,
          eyebrow: false,
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
      header: {
        actionSize: "sm",
        actionSlots: 1,
        actionWidths: ["wide"],
        description: false,
        eyebrow: false,
      },
      kind: "record-list",
      width: "standard",
    });
  }
  if (normalizedPathname === "/admin/accounts") {
    const description =
      "Discordでログインできるアカウントと管理者権限を管理します。試合参加者とは別に扱います。";
    return defineRoutePresentation(
      {
        header: { actionSlots: 0, description: true, descriptionText: description, eyebrow: true },
        kind: "record-list",
        width: "standard",
      },
      {
        description,
        eyebrow: "管理",
      },
    );
  }
  if (normalizedPathname === "/matches/new") {
    const description = "開催と4人分の結果を入力して、確定前の確認へ進みます。";
    return defineRoutePresentation(
      {
        header: {
          actionSize: "sm",
          actionSlots: 1,
          actionWidths: ["long"],
          description: true,
          descriptionText: description,
          eyebrow: false,
        },
        kind: "workspace",
        width: "workspace",
      },
      {
        description,
        headerNavigation: {
          href: returnTo ?? "/matches",
          label: "入力をやめる",
        },
      },
    );
  }
  if (/^\/review\/[^/]+$/u.test(normalizedPathname)) {
    const description =
      "読み取り結果を確認して、開催と4人分の結果を確定します。現在の状態: 状態不明";
    return defineRoutePresentation(
      {
        header: {
          actionSize: "sm",
          actionSlots: 1,
          actionWidths: ["long"],
          description: true,
          descriptionText: description,
          eyebrow: false,
        },
        kind: "workspace",
        width: "workspace",
      },
      {
        description,
        headerNavigation: {
          href: returnTo ?? "/matches",
          label: "入力をやめる",
        },
      },
    );
  }
  if (/^\/matches\/[^/]+\/edit$/u.test(normalizedPathname)) {
    const description = "確定済みの試合記録を編集します。保存後は一覧と出力に反映されます。";
    return defineRoutePresentation(
      {
        header: {
          actionSize: "sm",
          actionSlots: 1,
          actionWidths: ["long"],
          description: true,
          descriptionText: description,
          eyebrow: false,
        },
        kind: "workspace",
        width: "workspace",
      },
      {
        description,
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
        header: {
          actionSize: "sm",
          actionSlots: hasReturnTo ? 1 : 0,
          actionWidths: hasReturnTo ? ["wide"] : [],
          description: false,
          eyebrow: false,
        },
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
      },
    );
  }
  if (/^\/held-events\/[^/]+$/u.test(normalizedPathname)) {
    return defineRoutePresentation(
      {
        header: {
          actionLayout: "responsive-grid",
          actionSize: "sm",
          actionSlots: 3,
          actionWidths: ["wide", "standard", "compact"],
          description: true,
          eyebrow: true,
        },
        kind: "detail",
        leadingActionSlot: true,
        width: "wide",
      },
      {
        eyebrow: "開催記録",
        leadingNavigation: {
          href: returnTo ?? "/held-events",
          label: "開催履歴へ戻る",
        },
      },
    );
  }
  if (normalizedPathname === "/analytics/series") {
    return defineRoutePresentation(
      {
        header: {
          actionSize: "sm",
          actionSlots: hasReturnTo ? 1 : 0,
          actionWidths: hasReturnTo ? ["wide"] : [],
          description: false,
          eyebrow: false,
        },
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
    const description = "保存済み分析の状態確認と、作品単位または全作品の再計算を行います。";
    return defineRoutePresentation(
      {
        header: { actionSlots: 0, description: true, descriptionText: description, eyebrow: true },
        kind: "sectioned-comparison",
        loadingLabel: "戦績分析管理を読み込んでいます",
        width: "wide",
      },
      {
        description,
        eyebrow: "管理",
      },
    );
  }
  if (normalizedPathname === "/admin/masters") {
    const handoffId = searchParams.get("handoffId");
    const returnDestination =
      returnTo && handoffId ? appendHandoffIdToReturnTo(returnTo, handoffId) : returnTo;
    return defineRoutePresentation(
      {
        contextNoticeSlot: hasReturnTo,
        header: { actionSlots: 0, description: false, eyebrow: true },
        kind: "catalog",
        loadingLabel: "設定管理を読み込んでいます",
        width: "standard",
      },
      {
        contextNavigation: returnDestination
          ? { href: returnDestination, label: "元の画面へ戻る" }
          : undefined,
        eyebrow: "管理",
      },
    );
  }
  if (normalizedPathname === "/exports") {
    return defineRoutePresentation(
      {
        header: { actionSlots: 0, description: false, eyebrow: false },
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
    header: { actionSlots: 0, description: false, eyebrow: false },
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
