import { expect, it, vi } from "vitest";

import { installMatchMediaController } from "@/test/doubles/dom";

it("updates existing MediaQueryLists before notifying their consumers", () => {
  const controller = installMatchMediaController(false);
  try {
    const viewport = window.matchMedia("(max-width: 1119px)");
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onViewportChange = vi.fn(() => viewport.matches);
    const onMotionChange = vi.fn(() => motion.matches);
    viewport.addEventListener("change", onViewportChange);
    motion.addEventListener("change", onMotionChange);

    controller.setMatches(true);
    expect(onViewportChange.mock.results[0]?.value).toBe(true);
    expect(motion.matches).toBe(false);
    expect(onMotionChange).not.toHaveBeenCalled();

    controller.setReducedMotion(true);
    expect(onMotionChange.mock.results[0]?.value).toBe(true);
    expect(viewport.matches).toBe(true);
    expect(onViewportChange).toHaveBeenCalledOnce();

    controller.setReducedMotion(false);
    expect(onMotionChange.mock.results[1]?.value).toBe(false);
    expect(motion.matches).toBe(false);
  } finally {
    controller.restore();
  }
});
