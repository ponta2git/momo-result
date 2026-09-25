import { useEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

import { revealPageElement } from "@/shared/ui/layout/revealPageElement";
import { adjacentNavigationState } from "@/shared/ui/navigation/AdjacentNavigation";

/** Focuses only a completed adjacent-link visit, unless the user acted while it was loading. */
export function useAdjacentNavigationFocus(ready: boolean) {
  const location = useLocation();
  const navigationType = useNavigationType();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const settledKey = useRef<string | undefined>(undefined);
  const state: unknown = location.state;
  const isAdjacentVisit =
    state !== null &&
    typeof state === "object" &&
    "adjacentNavigation" in state &&
    state.adjacentNavigation === adjacentNavigationState.adjacentNavigation;

  useEffect(() => {
    if (!isAdjacentVisit || navigationType !== "PUSH" || settledKey.current === location.key) {
      return;
    }
    const cancel = () => {
      settledKey.current = location.key;
    };
    if (ready) {
      const heading = headingRef.current;
      if (heading) {
        settledKey.current = location.key;
        heading.focus({ preventScroll: true });
        revealPageElement(heading);
      }
      return;
    }
    document.addEventListener("pointerdown", cancel, true);
    document.addEventListener("keydown", cancel, true);
    document.addEventListener("focusin", cancel, true);
    return () => {
      document.removeEventListener("pointerdown", cancel, true);
      document.removeEventListener("keydown", cancel, true);
      document.removeEventListener("focusin", cancel, true);
    };
  }, [isAdjacentVisit, location.key, navigationType, ready]);

  return headingRef;
}
