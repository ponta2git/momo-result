import type { ReactNode } from "react";

/** Keeps the ready and loading views on the same chart, editor, and result slots. */
export function OutlookWorkspaceLayout({
  chart,
  editor,
  results,
}: {
  chart: ReactNode;
  editor: ReactNode;
  results: ReactNode;
}) {
  return (
    <div className="grid min-w-0 grid-cols-1 items-start gap-6 lg:grid-cols-2 lg:grid-rows-[auto_minmax(0,1fr)]">
      <div className="grid min-w-0 grid-cols-1 gap-2 lg:col-start-1 lg:row-start-1">{chart}</div>
      <div className="min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1">{editor}</div>
      <div className="min-w-0 lg:col-start-1 lg:row-start-2">{results}</div>
    </div>
  );
}
