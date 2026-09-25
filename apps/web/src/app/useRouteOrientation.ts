import { useLayoutEffect, useRef } from "react";
import { useLocation, useMatches, useNavigationType } from "react-router-dom";

import { adjacentNavigationState } from "@/shared/ui/navigation/AdjacentNavigation";

/** Route metadata owns browser orientation; query state and adjacent visits own their own focus. */
export function useRouteOrientation() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const matches = useMatches();
  const previousPath = useRef(location.pathname);
  const handle: unknown = matches.at(-1)?.handle;
  const title =
    handle && typeof handle === "object" && "title" in handle && typeof handle.title === "string"
      ? handle.title
      : "momo-result";

  useLayoutEffect(() => {
    document.title = `${title} | 桃鉄戦績台帳`;
  }, [title]);

  useLayoutEffect(() => {
    if (previousPath.current === location.pathname) return;
    previousPath.current = location.pathname;
    const state: unknown = location.state;
    const adjacentVisit =
      state !== null &&
      typeof state === "object" &&
      "adjacentNavigation" in state &&
      state.adjacentNavigation === adjacentNavigationState.adjacentNavigation;
    if (navigationType === "POP" || adjacentVisit || location.hash) return;

    // Focus the stable landmark immediately, including during loading. A later response must
    // never take focus back from someone who has already started interacting with the page.
    document.getElementById("main-content")?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [location.hash, location.pathname, location.state, navigationType]);
}
