import { trimSearchParam } from "@/shared/lib/searchParams";
import { PageLoadingFallback } from "@/shared/ui/feedback/PageLoadingFallback";
import type {
  PageLoadingContentToolbarShape,
  PageLoadingFallbackProps,
  PageLoadingHeaderShape,
} from "@/shared/ui/feedback/PageLoadingFallback";
import type { PageContentSurfacePadding } from "@/shared/ui/layout/PageContentSurface";
import type { PageFrameWidth } from "@/shared/ui/layout/PageFrame";
import type { PageHeaderDescriptionStatus } from "@/shared/ui/layout/PageHeader";
import {
  matchWorkspacePageWidth,
  workspaceSampleStatus,
} from "@/shared/workflows/matchWorkspacePresentation";
import { MatchWorkspaceSkeleton } from "@/shared/workflows/MatchWorkspaceSkeleton";
import type { MatchWorkspaceSkeletonProps } from "@/shared/workflows/MatchWorkspaceSkeleton";

type RouteSuspenseFallbackProps = {
  asMain?: boolean | undefined;
  loadingLabel?: string | undefined;
  pathname: string;
  search?: string | undefined;
};

type RouteLoadingPresentation = {
  contentToolbar?: PageLoadingContentToolbarShape | undefined;
  /** Match entry routes reuse the editor's own skeleton, decided from the URL alone. */
  matchWorkspace?: MatchWorkspaceSkeletonProps | undefined;
  header?: PageLoadingHeaderShape | undefined;
  kind: NonNullable<PageLoadingFallbackProps["kind"]>;
  leadingActionSlot?: boolean;
  loadingLabel?: PageLoadingFallbackProps["loadingLabel"];
  width: PageFrameWidth;
};

type RouteTerminalPresentation = {
  /** A back link whose destination the pathname alone fixes, kept in the ready position. */
  backLink?: { href: string; label: string } | undefined;
  contentPadding: PageContentSurfacePadding;
  description?: string | undefined;
  descriptionStatus?: PageHeaderDescriptionStatus | undefined;
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
      loadingLabel: "試合一覧を読み込み中",
      width: "default",
    });
  }
  if (normalizedPathname === "/held-events") {
    return defineRoutePresentation({
      kind: "list",
      loadingLabel: "開催履歴を読み込み中",
      width: "default",
    });
  }
  if (normalizedPathname === "/drafts") {
    return defineRoutePresentation({
      contentToolbar: { actionSize: "sm", actionSlots: 3, actionWidths: ["icon", "long", "long"] },
      kind: "grouped-list",
      loadingLabel: "下書きを読み込み中",
      width: "default",
    });
  }
  if (
    normalizedPathname === "/matches/new" ||
    /^\/matches\/[^/]+\/edit$/u.test(normalizedPathname) ||
    /^\/review\/[^/]+$/u.test(normalizedPathname)
  ) {
    const searchParams = new URLSearchParams(search);
    const mode = normalizedPathname.startsWith("/review/")
      ? "review"
      : normalizedPathname === "/matches/new"
        ? "create"
        : "edit";
    const sample = mode === "review" && searchParams.get("sample") === "1";
    const descriptionStatus = sample ? workspaceSampleStatus : undefined;
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
        matchWorkspace: {
          mode,
          sample,
          sourcePanel:
            matchWorkspacePageWidth({
              matchDraftId:
                mode === "review"
                  ? normalizedPathname.slice("/review/".length)
                  : trimSearchParam(searchParams.get("matchDraftId")),
              mode,
              sample,
            }) === "workspace",
        },
        width: matchWorkspacePageWidth({
          matchDraftId:
            mode === "review"
              ? normalizedPathname.slice("/review/".length)
              : trimSearchParam(searchParams.get("matchDraftId")),
          mode,
          sample,
        }),
      },
      { descriptionStatus },
    );
  }
  if (normalizedPathname === "/ocr/new") {
    return defineRoutePresentation({
      contentToolbar: {
        actionPlacement: "leading",
        actionSize: "sm",
        actionSlots: 1,
        actionWidths: ["long"],
      },
      kind: "capture",
      width: "default",
    });
  }
  if (/^\/(?:matches|m)\/[^/]+$/u.test(normalizedPathname)) {
    return defineRoutePresentation(
      {
        header: {
          actionSize: "sm",
          actionSlots: 2,
          actionWidths: ["wide", "wide"],
          description: false,
        },
        kind: "detail",
        leadingActionSlot: true,
        width: "analysis",
      },
      { backLink: { href: "/matches", label: "試合一覧へ" }, preserveHeader: true },
    );
  }
  if (/^\/(?:held-events|e)\/[^/]+$/u.test(normalizedPathname)) {
    return defineRoutePresentation(
      {
        header: {
          actionSize: "sm",
          actionSlots: 2,
          actionWidths: ["standard", "compact"],
          description: true,
        },
        kind: "detail",
        leadingActionSlot: true,
        width: "analysis",
      },
      {
        backLink: { href: "/held-events", label: "開催履歴へ" },
        description: "試合数・下書き数は未取得です。",
        preserveHeader: true,
      },
    );
  }
  if (normalizedPathname === "/analytics/series") {
    return defineRoutePresentation({
      kind: "comparison",
      loadingLabel: "戦績比較を読み込んでいます",
      width: "analysis",
    });
  }
  if (normalizedPathname === "/achievements") {
    return defineRoutePresentation({
      kind: "field-sections",
      loadingLabel: "実績を読み込み中",
      width: "analysis",
    });
  }
  if (normalizedPathname === "/admin/analysis") {
    return defineRoutePresentation({
      kind: "sectioned-comparison",
      loadingLabel: "戦績分析管理を読み込んでいます",
      width: "analysis",
    });
  }
  if (normalizedPathname === "/admin/masters") {
    return defineRoutePresentation({
      kind: "catalog",
      loadingLabel: "設定管理を読み込んでいます",
      width: "default",
    });
  }
  if (normalizedPathname === "/login") {
    return defineRoutePresentation({ kind: "generic", width: "readable" });
  }
  if (normalizedPathname === "/exports") {
    return defineRoutePresentation({ kind: "form", width: "readable" });
  }
  return defineRoutePresentation({
    kind: "generic",
    width: "default",
  });
}

/** Lets viewport-level chrome follow the width the current route's page uses. */
export function routePageWidth(pathname: string, search = ""): PageFrameWidth {
  return routePagePresentation(pathname, search).loading.width;
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
  const { matchWorkspace, ...shape } = presentation;
  return (
    <PageLoadingFallback
      asMain={asMain}
      {...shape}
      content={matchWorkspace ? <MatchWorkspaceSkeleton {...matchWorkspace} /> : undefined}
      contentPadding={terminal.contentPadding}
      loadingLabel={loadingLabel ?? presentation.loadingLabel}
    />
  );
}
