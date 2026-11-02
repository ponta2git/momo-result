import { useLayoutEffect, useRef, useState } from "react";

/**
 * Draws a chart at its rendered pixel width, so axis text keeps its specified size instead of
 * scaling with the viewport. The plot fills the available width up to `maximum`; below
 * `minimum` it keeps that width and scrolls inside its own container.
 */
export function useChartWidth(minimum: number, maximum: number) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState<number | undefined>();
  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const measure = () => setAvailable(Math.floor(element.clientWidth));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const width = Math.min(maximum, Math.max(minimum, available ?? minimum));
  return { containerRef, width };
}
