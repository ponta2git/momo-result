import { PageLoadingFallback } from "@/shared/ui/feedback/PageLoadingFallback";
import type {
  PageLoadingContentToolbarShape,
  PageLoadingFallbackProps,
  PageLoadingHeaderShape,
} from "@/shared/ui/feedback/PageLoadingFallback";
import type { PageContentSurfacePadding } from "@/shared/ui/layout/PageContentSurface";
import type { PageFrameWidth } from "@/shared/ui/layout/PageFrame";
import type { PageHeaderDescriptionStatus } from "@/shared/ui/layout/PageHeader";
import { workspaceSampleStatus } from "@/shared/workflows/matchWorkspacePresentation";

type RouteSuspenseFallbackProps = {
  asMain?: boolean | undefined;
  loadingLabel?: string | undefined;
  pathname: string;
  search?: string | undefined;
};

type RouteLoadingPresentation = {
  contentToolbar?: PageLoadingContentToolbarShape | undefined;
  header?: PageLoadingHeaderShape | undefined;
  kind: NonNullable<PageLoadingFallbackProps["kind"]>;
  leadingActionSlot?: boolean;
  loadingLabel?: PageLoadingFallbackProps["loadingLabel"];
  width: PageFrameWidth;
};

type RouteTerminalPresentation = {
  contentPadding: PageContentSurfacePadding;
  description?: string | undefined;
  descriptionStatus?: PageHeaderDescriptionStatus | undefined;
  eyebrow?: string | undefined;
  preserveHeader?: boolean | undefined;
  width: PageFrameWidth;
};

type RoutePagePresentation = {
  loading: RouteLoadingPresentation;
  terminal: RouteTerminalPresentation;
};

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
function routePagePresentation(pathname: string, search = ""): RoutePagePresentation {
  const normalizedPathname = pathname.replace(/\/+$/u, "") || "/";

  if (normalizedPathname === "/matches") {
    return defineRoutePresentation({
      contentToolbar: {
        actionSize: "sm",
        actionSlots: 2,
        actionWidths: ["standard", "wide"],
      },
      kind: "list",
      width: "standard",
    });
  }
  if (normalizedPathname === "/held-events") {
    return defineRoutePresentation({
      kind: "record-list",
      width: "standard",
    });
  }
  if (
    normalizedPathname === "/matches/new" ||
    /^\/matches\/[^/]+\/edit$/u.test(normalizedPathname) ||
    /^\/review\/[^/]+$/u.test(normalizedPathname)
  ) {
    const descriptionStatus =
      normalizedPathname.startsWith("/review/") && new URLSearchParams(search).get("sample") === "1"
        ? workspaceSampleStatus
        : undefined;
    return defineRoutePresentation(
      {
        contentToolbar: {
          actionPlacement: "leading",
          actionSize: "sm",
          actionSlots: 1,
          actionWidths: ["long"],
          status: descriptionStatus,
        },
        kind: "workspace",
        width: "workspace",
      },
      { descriptionStatus },
    );
  }
  if (normalizedPathname === "/ocr/new") {
    return defineRoutePresentation({
      kind: "workspace",
      leadingActionSlot: true,
      width: "standard",
    });
  }
  if (/^\/matches\/[^/]+$/u.test(normalizedPathname)) {
    return defineRoutePresentation(
      {
        header: {
          actionSize: "sm",
          actionSlots: 2,
          actionWidths: ["wide", "wide"],
          description: true,
          eyebrow: false,
        },
        kind: "detail",
        leadingActionSlot: true,
        width: "wide",
      },
      { preserveHeader: true },
    );
  }
  if (/^\/held-events\/[^/]+$/u.test(normalizedPathname)) {
    return defineRoutePresentation(
      {
        header: {
          actionSize: "sm",
          actionSlots: 2,
          actionWidths: ["standard", "compact"],
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
        preserveHeader: true,
      },
    );
  }
  if (normalizedPathname === "/analytics/series") {
    return defineRoutePresentation({
      kind: "comparison",
      loadingLabel: "戦績比較を読み込んでいます",
      width: "wide",
    });
  }
  if (normalizedPathname === "/admin/analysis") {
    return defineRoutePresentation({
      kind: "sectioned-comparison",
      loadingLabel: "戦績分析管理を読み込んでいます",
      width: "wide",
    });
  }
  if (normalizedPathname === "/admin/masters") {
    return defineRoutePresentation({
      kind: "catalog",
      loadingLabel: "設定管理を読み込んでいます",
      width: "standard",
    });
  }
  if (normalizedPathname === "/exports") {
    return defineRoutePresentation(
      { kind: "form", width: "narrow" },
      { contentPadding: "compact" },
    );
  }
  return defineRoutePresentation({
    kind: "generic",
    width: "standard",
  });
}

export function routeTerminalPresentation(
  pathname: string,
  search = "",
): RouteTerminalPresentation {
  return routePagePresentation(pathname, search).terminal;
}

export function RouteSuspenseFallback({
  asMain = false,
  loadingLabel,
  pathname,
  search = "",
}: RouteSuspenseFallbackProps) {
  const { loading: presentation, terminal } = routePagePresentation(pathname, search);
  return (
    <PageLoadingFallback
      asMain={asMain}
      {...presentation}
      contentPadding={terminal.contentPadding}
      loadingLabel={loadingLabel ?? presentation.loadingLabel}
    />
  );
}
