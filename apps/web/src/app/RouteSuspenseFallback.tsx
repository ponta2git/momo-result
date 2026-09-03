import { sanitizeReturnTo } from "@/shared/navigation/returnTo";
import { PageLoadingFallback } from "@/shared/ui/feedback/PageLoadingFallback";
import type {
  PageLoadingFallbackProps,
  PageLoadingHeaderShape,
} from "@/shared/ui/feedback/PageLoadingFallback";
import type { PageFrameWidth } from "@/shared/ui/layout/PageFrame";

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

/** Keeps pathname-to-layout knowledge in the app layer rather than shared UI. */
export function routeLoadingPresentation(pathname: string, search = ""): RouteLoadingPresentation {
  const normalizedPathname = pathname.replace(/\/+$/u, "") || "/";
  const hasReturnTo = Boolean(sanitizeReturnTo(new URLSearchParams(search).get("returnTo")));

  if (normalizedPathname === "/matches") {
    return {
      header: { actionSize: "sm", actionSlots: 2, description: false, eyebrow: false },
      kind: "list",
      leadingActionSlot: hasReturnTo,
      width: "standard",
    };
  }
  if (normalizedPathname === "/held-events") {
    return {
      header: { actionSize: "sm", actionSlots: 1, description: false, eyebrow: false },
      kind: "record-list",
      width: "standard",
    };
  }
  if (normalizedPathname === "/admin/accounts") {
    return {
      header: { actionSlots: 0, description: true, eyebrow: true },
      kind: "record-list",
      width: "standard",
    };
  }
  if (
    normalizedPathname === "/matches/new" ||
    /^\/review\/[^/]+$/u.test(normalizedPathname) ||
    /^\/matches\/[^/]+\/edit$/u.test(normalizedPathname)
  ) {
    return {
      header: { actionSize: "sm", actionSlots: 1, description: true, eyebrow: false },
      kind: "workspace",
      width: "workspace",
    };
  }
  if (normalizedPathname === "/ocr/new") {
    return {
      header: {
        actionSize: "sm",
        actionSlots: hasReturnTo ? 1 : 0,
        description: false,
        eyebrow: false,
      },
      kind: "workspace",
      width: "standard",
    };
  }
  if (/^\/matches\/[^/]+$/u.test(normalizedPathname)) {
    return {
      header: { actionSize: "md", actionSlots: 2, description: false, eyebrow: false },
      kind: "detail",
      leadingActionSlot: true,
      width: "wide",
    };
  }
  if (/^\/held-events\/[^/]+$/u.test(normalizedPathname)) {
    return {
      header: { actionSize: "sm", actionSlots: 3, description: true, eyebrow: true },
      kind: "detail",
      leadingActionSlot: true,
      width: "wide",
    };
  }
  if (normalizedPathname === "/analytics/series") {
    return {
      header: {
        actionSize: "sm",
        actionSlots: hasReturnTo ? 1 : 0,
        description: false,
        eyebrow: false,
      },
      kind: "comparison",
      loadingLabel: "戦績比較を読み込んでいます",
      width: "wide",
    };
  }
  if (normalizedPathname === "/admin/analysis") {
    return {
      header: { actionSlots: 0, description: true, eyebrow: true },
      kind: "sectioned-comparison",
      loadingLabel: "戦績分析管理を読み込んでいます",
      width: "wide",
    };
  }
  if (normalizedPathname === "/admin/masters") {
    return {
      contextNoticeSlot: hasReturnTo,
      header: { actionSlots: 0, description: false, eyebrow: true },
      kind: "catalog",
      loadingLabel: "設定管理を読み込んでいます",
      width: "standard",
    };
  }
  if (normalizedPathname === "/exports") {
    return {
      header: { actionSlots: 0, description: false, eyebrow: false },
      kind: "form",
      leadingActionSlot: hasReturnTo,
      width: "narrow",
    };
  }
  return {
    header: { actionSlots: 0, description: false, eyebrow: false },
    kind: "generic",
    width: "standard",
  };
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
