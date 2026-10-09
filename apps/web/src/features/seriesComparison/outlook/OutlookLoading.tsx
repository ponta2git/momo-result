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
            <Skeleton key={task} className="-mb-px h-11 w-32 shrink-0 pointer-fine:h-9" />
          ))}
        </div>
        <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-[minmax(18rem,2fr)_minmax(0,3fr)]">
          <div className="grid min-w-0 grid-cols-1 content-start gap-6">
            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <Skeleton className="h-5 w-40 max-w-full" />
                <Skeleton className="h-11 w-24 shrink-0 pointer-fine:h-9" />
              </div>
              <Skeleton className="max-w-full text-xs/4">
                <span className="invisible">小さいほど上位。初期値は作品全体の直近20戦です。</span>
              </Skeleton>
            </div>
            {["first", "second"].map((person) => (
              <div key={person} className="grid min-w-0 grid-cols-1 gap-2">
                <Skeleton className="h-5 w-24 max-w-full" />
                <Skeleton className="h-4 w-32 max-w-full" />
                <div>
                  <Skeleton className="mb-2 h-5 w-40 max-w-full" />
                  <Skeleton className="h-11 w-full rounded-sm pointer-fine:h-10" />
                  <div className="mt-2 flex h-11 items-center">
                    <Skeleton className="h-2 w-full rounded-full" />
                  </div>
                  <Skeleton className="mt-1 h-4 w-full" />
                </div>
                <div className="grid gap-1">
                  <Skeleton className="h-4 w-40 max-w-full" />
                  <Skeleton className="h-11 w-52 max-w-full pointer-fine:h-9" />
                </div>
              </div>
            ))}
            <div className="grid gap-2">
              <Skeleton className="h-11 w-44 max-w-full pointer-fine:h-9" />
              <div className="h-8" />
            </div>
          </div>
          <div className="grid min-w-0 grid-cols-1 content-start gap-6">
            <div className="grid min-w-0 grid-cols-1 gap-2">
              <Skeleton className="h-5 w-40 max-w-full" />
              <Skeleton className="h-14 w-4/5" />
              <div className="h-4" />
              <Skeleton className="h-11 w-44 max-w-full pointer-fine:h-9" />
            </div>
            <div className="@container/outlook-patterns grid min-w-0 grid-cols-1 gap-4">
              <div className="grid min-w-0 gap-1">
                <div className="grid min-w-0 grid-cols-2 gap-4">
                  {["horizon", "range"].map((field) => (
                    <div key={field} className="grid min-w-0 grid-cols-1 gap-2">
                      <Skeleton className="h-5 w-24 max-w-full" />
                      <Skeleton className="h-11 w-28 max-w-full rounded-sm pointer-fine:h-10" />
                    </div>
                  ))}
                </div>
                <Skeleton className="h-10 w-full" />
              </div>
              <div aria-hidden="true" className="min-w-0" inert>
                <DataTable
                  caption={{
                    content: <Skeleton className="h-5 w-full" />,
                    visibility: "visible",
                  }}
                  density="compact"
                  layout="fixed"
                  rows={["current", "average", "good", "middle", "poor"]}
                  getRowKey={(row) => row}
                  columns={[
                    {
                      key: "person",
                      header: <Skeleton className="h-8 w-20 max-w-full" />,
                      rowHeader: true,
                      width: "34%",
                      renderCell: () => <Skeleton className="h-5 w-20 max-w-full" />,
                    },
                    ...["first", "second"].map((key) => ({
                      key,
                      header: <Skeleton className="h-8 w-12 max-w-full" />,
                      renderCell: () => <Skeleton className="h-10 w-12 max-w-full" />,
                    })),
                  ]}
                />
              </div>
              <div className="grid gap-2">
                <Skeleton className="h-4 w-64 max-w-full" />
                <Skeleton className="h-5 w-48 max-w-full" />
                <Skeleton className="h-5 w-64 max-w-full" />
                <Skeleton className="h-8 w-72 max-w-full" />
              </div>
              <div className="grid min-w-0 grid-cols-1 gap-6 @xl/outlook-patterns:grid-cols-2">
                {["average", "good", "middle", "poor"].map((pattern) => (
                  <div key={pattern} className="grid gap-2">
                    <Skeleton className="h-5 w-24 max-w-full" />
                    <Skeleton className="h-[230px] w-full" />
                  </div>
                ))}
              </div>
              <div className="grid gap-2">
                <Skeleton className="max-w-full text-xs/4">
                  <span className="invisible">
                    数値は小数第2位に丸めていますが、同率の判定は丸める前の値を使います。
                  </span>
                </Skeleton>
                <Skeleton className="max-w-full text-xs/4">
                  <span className="invisible">
                    この人にとって100戦後の差が有利・中間・不利な展開例です。確率や上下限を示すものではありません。
                  </span>
                </Skeleton>
              </div>
            </div>
          </div>
        </div>
      </div>
      <Skeleton className="h-11 w-52 max-w-full" />
    </div>
  );
}
