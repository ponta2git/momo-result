import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode, RefObject } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

import type { SeriesAnalysisDisplayIntent } from "@/features/seriesComparison/navigation/useSeriesAnalysisLocationState";
import { revealPageElement } from "@/shared/ui/layout/revealPageElement";

class Visit {
  readonly expandedMembers = new Set<string>();
  position?: { x: number; y: number };
  originId?: string;
  cancelled = false;
  handled = false;
  begin() {
    this.cancelled = false;
    this.handled = false;
  }
  cancel() {
    this.cancelled = true;
  }
  consume() {
    this.handled = true;
  }

  inheritPosition(saved: { x: number; y: number }) {
    this.position = saved;
    this.consume();
  }

  capture(originId?: string) {
    if (originId) this.originId = originId;
    this.position = position();
  }
}

type Navigation = {
  arrive: (root: HTMLElement) => void;
  rememberOrigin: (id: string) => void;
  visit: Visit;
};

const NavigationContext = createContext<Navigation | null>(null);

function position() {
  return { x: window.scrollX, y: window.scrollY };
}

/** Keeps only this page's recent visits; data caches and the application router remain independent. */
export function SeriesAnalysisNavigation({
  children,
  failed = false,
  displayIntent,
}: {
  children: ReactNode;
  failed?: boolean;
  displayIntent?: SeriesAnalysisDisplayIntent | undefined;
}) {
  const location = useLocation();
  const navigationType = useNavigationType();
  const [visits] = useState(() => new Map<string, Visit>());
  const appliedDisplay = useRef<{ operation: number; visitKey: string } | undefined>(undefined);
  const visitKey = `${location.key}:${location.hash}`;
  const visit = useMemo(() => visits.get(visitKey) ?? new Visit(), [visitKey, visits]);

  useLayoutEffect(() => {
    // Native fragment restoration can run after our lazy body commits and overwrite its position.
    // Own restoration only while this page is mounted, then restore the application's prior mode.
    const previous = window.history.scrollRestoration;
    const restore = () => {
      window.history.scrollRestoration = previous;
    };
    const resume = () => {
      window.history.scrollRestoration = "manual";
    };
    window.history.scrollRestoration = "manual";
    window.addEventListener("pagehide", restore);
    window.addEventListener("pageshow", resume);
    return () => {
      window.removeEventListener("pagehide", restore);
      window.removeEventListener("pageshow", resume);
      restore();
    };
  }, []);

  useLayoutEffect(() => {
    visit.begin();
    visits.set(visitKey, visit);
    // Evicted visits still have a usable URL; detailed restoration is a bounded convenience.
    const oldestKey = visits.keys().next().value;
    if (visits.size > 32 && oldestKey) visits.delete(oldestKey);
    const savePosition = () => {
      if (visit.handled) visit.capture();
    };
    const cancel = () => {
      visit.cancel();
    };
    const initialFocus = document.activeElement;
    const cancelFocus = (event: FocusEvent) => {
      if (event.target !== initialFocus && event.target !== document.body) cancel();
    };
    const cancelKey = (event: KeyboardEvent) => {
      if (
        ["Tab", "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(
          event.key,
        )
      )
        cancel();
    };
    window.addEventListener("scroll", savePosition, { passive: true });
    window.addEventListener("wheel", cancel, { passive: true });
    window.addEventListener("touchmove", cancel, { passive: true });
    document.addEventListener("pointerdown", cancel, true);
    document.addEventListener("keydown", cancelKey, true);
    document.addEventListener("focusin", cancelFocus, true);
    return () => {
      visit.cancel();
      window.removeEventListener("scroll", savePosition);
      window.removeEventListener("wheel", cancel);
      window.removeEventListener("touchmove", cancel);
      document.removeEventListener("pointerdown", cancel, true);
      document.removeEventListener("keydown", cancelKey, true);
      document.removeEventListener("focusin", cancelFocus, true);
    };
  }, [visit, visitKey, visits]);

  useLayoutEffect(() => {
    const target = `${location.pathname}${location.search}${location.hash}`;
    const applied = appliedDisplay.current;
    if (
      navigationType === "REPLACE" &&
      displayIntent?.target === target &&
      displayIntent.sourceVisit !== visitKey &&
      visits.has(displayIntent.sourceVisit) &&
      (!applied || applied.operation !== displayIntent.operation || applied.visitKey === visitKey)
    ) {
      // Reapply to the same visit after Strict Mode's effect restart; never consume during render.
      visit.inheritPosition(displayIntent.position);
      appliedDisplay.current = { operation: displayIntent.operation, visitKey };
    } else if (
      displayIntent &&
      displayIntent.sourceVisit !== visitKey &&
      (navigationType === "POP" || displayIntent.target !== target)
    ) {
      appliedDisplay.current = { operation: displayIntent.operation, visitKey: "" };
    }
  }, [
    displayIntent,
    location.hash,
    location.pathname,
    location.search,
    navigationType,
    visit,
    visitKey,
    visits,
  ]);

  useEffect(() => {
    if (failed) visit.cancel();
  }, [failed, visit]);

  const arrive = useCallback(
    (root: HTMLElement) => {
      if (visit.handled || root.closest("[inert]")) return;
      visit.consume();
      if (visit.cancelled) {
        visit.capture();
        return;
      }
      if (navigationType === "POP" && visit.position) {
        const saved = visit.position;
        window.scrollTo({ behavior: "instant", left: saved.x, top: saved.y });
        const origin = visit.originId ? document.getElementById(visit.originId) : null;
        if (origin && root.contains(origin)) {
          origin.focus({ preventScroll: true });
          revealPageElement(origin);
        }
      } else {
        let id: string;
        try {
          id = decodeURIComponent(location.hash.slice(1));
        } catch {
          return;
        }
        const section = id ? document.getElementById(id) : null;
        if (section?.tagName === "SECTION" && root.contains(section)) {
          const heading = section.querySelector<HTMLElement>("h2, h3");
          if (!heading) return;
          heading.focus({ preventScroll: true });
          revealPageElement(section, "start");
        }
      }
      visit.capture();
    },
    [location.hash, navigationType, visit],
  );

  const rememberOrigin = useCallback(
    (id: string) => {
      visit.capture(id);
    },
    [visit],
  );
  const navigation = useMemo(
    () => ({ arrive, rememberOrigin, visit }),
    [arrive, rememberOrigin, visit],
  );
  return <NavigationContext value={navigation}>{children}</NavigationContext>;
}

export function useSeriesAnalysisNavigation() {
  return useContext(NavigationContext);
}

/** Mount inside the same Suspense boundary as the actual destination, never its fallback. */
export function SeriesAnalysisArrival({
  ready,
  root,
}: {
  ready: boolean;
  root: RefObject<HTMLDivElement | null>;
}) {
  const navigation = useSeriesAnalysisNavigation();
  useEffect(() => {
    if (ready && root.current) navigation?.arrive(root.current);
  }, [navigation, ready, root]);
  return null;
}
