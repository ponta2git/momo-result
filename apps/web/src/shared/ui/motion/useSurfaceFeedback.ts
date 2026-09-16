import { animate, motionValue, styleEffect } from "motion/react";
import { useCallback } from "react";
import type { Ref } from "react";

import { surfaceHoverTransition } from "@/shared/ui/motion/transitions";

/**
 * Projects pointer presence onto a surface without owning activation or semantic state.
 * Native leave is deliberate: Motion's hover recognizer defers leave while pressed.
 * Color roles, pressed, unavailable and focus remain immediate CSS/native projections.
 */
export function useSurfaceFeedback<Element extends HTMLElement>(forwardedRef?: Ref<Element>) {
  return useCallback(
    (element: Element | null) => {
      if (!element) return;

      const refCleanup = typeof forwardedRef === "function" ? forwardedRef(element) : undefined;
      // oxlint-disable-next-line react/immutability -- React object refs are assigned during ref attachment, never during render; cleanup mirrors this assignment.
      if (forwardedRef && typeof forwardedRef !== "function") forwardedRef.current = element;

      const reducedMotion = element.ownerDocument.defaultView?.matchMedia?.(
        "(prefers-reduced-motion: reduce)",
      );
      let animation: ReturnType<typeof animate> | undefined;
      let target = 0;
      const progress = motionValue(0);
      const stopPainting = styleEffect(element, { "--ui-hover": progress });
      element.style.setProperty("--ui-hover", "0");

      const update = (next: number, immediate = reducedMotion?.matches ?? false) => {
        if (target === next && !immediate) return;
        target = next;
        animation?.stop();
        if (immediate) {
          progress.jump(next);
          element.style.setProperty("--ui-hover", String(next));
          animation = undefined;
        } else {
          animation = animate(progress, next, surfaceHoverTransition);
        }
      };
      const enter = (event: PointerEvent) => {
        if (event.pointerType !== "touch") update(1);
      };
      const leave = () => update(0);
      const preferenceChanged = () => update(target, true);

      element.addEventListener("pointerenter", enter);
      element.addEventListener("pointerleave", leave);
      element.addEventListener("pointercancel", leave);
      reducedMotion?.addEventListener("change", preferenceChanged);

      return () => {
        element.removeEventListener("pointerenter", enter);
        element.removeEventListener("pointerleave", leave);
        element.removeEventListener("pointercancel", leave);
        reducedMotion?.removeEventListener("change", preferenceChanged);
        animation?.stop();
        stopPainting();
        progress.destroy();
        element.style.removeProperty("--ui-hover");
        if (typeof refCleanup === "function") refCleanup();
        else if (typeof forwardedRef === "function") forwardedRef(null);
        else if (forwardedRef) forwardedRef.current = null;
      };
    },
    [forwardedRef],
  );
}
