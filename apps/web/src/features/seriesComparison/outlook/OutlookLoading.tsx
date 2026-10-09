import { DataTable } from "@/shared/ui/data/DataTable";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";

/** Matches the two-person controls and their result while the first summary is prepared. */
export function OutlookLoading() {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-6" role="status">
      <span className="sr-only">見通しを読み込み中</span>
      <div className="@container/outlook-people grid max-w-2xl min-w-0 grid-cols-1 gap-2">
        <div className="grid min-w-0 grid-cols-1 gap-4 @xs/outlook-people:grid-cols-2">
          {["focus", "rival"].map((role) => (
            <div key={role} className="grid min-w-0 grid-cols-1 gap-2">
              <Skeleton className="h-5 w-24 max-w-full" />
              <Skeleton className="h-11 rounded-sm pointer-fine:h-10" />
            </div>
          ))}
        </div>
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-6">
        <div className="flex overflow-hidden border-b border-[var(--color-border)]">
          {["performance", "goal"].map((task) => (
            <Skeleton key={task} className="h-11 w-32 shrink-0 pointer-fine:h-9" />
          ))}
        </div>
        <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-[minmax(18rem,2fr)_minmax(0,3fr)]">
          <div className="grid min-w-0 grid-cols-1 content-start gap-6">
            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <Skeleton className="h-5 w-40 max-w-full" />
                <Skeleton className="h-11 w-24 shrink-0 pointer-fine:h-9" />
              </div>
              <Skeleton className="h-4 w-72 max-w-full" />
            </div>
            {["first", "second"].map((person) => (
              <div
                key={person}
                className={`grid min-w-0 grid-cols-1 gap-2 ${person === "second" ? "border-t border-[var(--color-border)] pt-6" : ""}`}
              >
                <Skeleton className="h-9 w-24 max-w-full" />
                <Skeleton className="h-5 w-40 max-w-full" />
                <Skeleton className="h-11 w-full rounded-sm pointer-fine:h-10" />
                <div className="flex h-11 items-center">
                  <Skeleton className="h-2 w-full rounded-full" />
                </div>
                <Skeleton className="h-4 w-64 max-w-full" />
                <Skeleton className="h-9 w-36 max-w-full" />
              </div>
            ))}
            <Skeleton className="h-11 w-44 max-w-full pointer-fine:h-9" />
          </div>
          <div className="grid min-w-0 grid-cols-1 content-start gap-6">
            <div className="grid min-w-0 grid-cols-1 gap-2">
              <Skeleton className="h-5 w-40 max-w-full" />
              <Skeleton className="h-7 w-4/5" />
              <Skeleton className="h-11 w-44 max-w-full pointer-fine:h-9" />
            </div>
            <div className="grid min-w-0 grid-cols-1 gap-3">
              <div className="flex overflow-hidden border-b border-[var(--color-border)]">
                {["average", "noise"].map((view) => (
                  <Skeleton key={view} className="h-11 w-32 shrink-0 pointer-fine:h-9" />
                ))}
              </div>
              <Skeleton className="h-5 w-40 max-w-full" />
              <Skeleton className="h-4 w-64 max-w-full" />
              <div className="grid min-w-0 grid-cols-2 gap-4">
                {["horizon", "range"].map((field) => (
                  <div key={field} className="grid min-w-0 grid-cols-1 gap-2">
                    <Skeleton className="h-5 w-24 max-w-full" />
                    <Skeleton className="h-11 w-28 max-w-full rounded-sm pointer-fine:h-10" />
                    <Skeleton className="h-4 w-20 max-w-full" />
                  </div>
                ))}
              </div>
              <div aria-hidden="true" className="min-w-0" inert>
                <DataTable
                  caption={{
                    content: "現在と指定戦数後の総合平均順位",
                    visibility: "screen-reader",
                  }}
                  density="compact"
                  layout="fixed"
                  rows={["first", "second"]}
                  getRowKey={(row) => row}
                  columns={[
                    {
                      key: "person",
                      header: <Skeleton className="h-4 w-20 max-w-full" />,
                      rowHeader: true,
                      width: "40%",
                      renderCell: () => <Skeleton className="h-5 w-20 max-w-full" />,
                    },
                    ...["current", "selected"].map((key) => ({
                      key,
                      header: <Skeleton className="h-4 w-12 max-w-full" />,
                      renderCell: () => <Skeleton className="h-5 w-12 max-w-full" />,
                    })),
                  ]}
                />
              </div>
              <Skeleton className="h-[258px] w-full" />
              <Skeleton className="h-5 w-48 max-w-full" />
              <Skeleton className="h-4 w-72 max-w-full" />
            </div>
          </div>
        </div>
      </div>
      <Skeleton className="h-11 w-52 max-w-full pointer-fine:h-9" />
    </div>
  );
}
