import { useLayoutEffect, useState } from "react";
import type { RefObject } from "react";

/** The gap the sticky position keeps under the navigation (`--sticky-below-nav`). */
const STICKY_GAP_PX = 16;

function navHeight() {
  const value = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue("--global-nav-height") || "0",
  );
  return Number.isFinite(value) ? value : 0;
}

/**
 * Keeps a column in view while the reader scrolls the answers, only while the whole column fits
 * below the navigation; otherwise fixing it would hide its own lower controls.
 */
export function useStickyWhenFits(ref: RefObject<HTMLElement | null>) {
  const [fits, setFits] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const check = () =>
      setFits(element.offsetHeight + navHeight() + STICKY_GAP_PX * 2 <= window.innerHeight);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(element);
    observer.observe(document.documentElement);
    window.addEventListener("resize", check);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", check);
    };
  }, [ref]);
  return fits;
}
