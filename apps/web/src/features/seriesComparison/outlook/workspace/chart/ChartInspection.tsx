import { createContext, use, useMemo, useState } from "react";
import type { ReactNode } from "react";

type ChartInspection = Readonly<{ h: number | null; set: (h: number | null) => void }>;
const ChartInspectionContext = createContext<ChartInspection | null>(null);

/**
 * One read-out position shared by graphs on the same horizontal axis. It lives apart from the
 * assumptions: reading a graph never changes them, and moving the pointer re-renders only the
 * graphs. A shorter range clamps the position.
 */
export function ChartInspectionProvider({
  range,
  children,
}: {
  range: number;
  children: ReactNode;
}) {
  const [h, set] = useState<number | null>(null);
  const clamped = h === null ? null : Math.min(h, range);
  const value = useMemo(() => ({ h: clamped, set }), [clamped]);
  return <ChartInspectionContext value={value}>{children}</ChartInspectionContext>;
}

/** The shared position, or a local one for a graph rendered on its own. */
export function useChartInspection(): ChartInspection {
  const shared = use(ChartInspectionContext);
  const [h, set] = useState<number | null>(null);
  return shared ?? { h, set };
}
