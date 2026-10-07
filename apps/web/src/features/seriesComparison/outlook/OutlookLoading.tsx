import { OutlookWorkspaceLayout } from "@/features/seriesComparison/outlook/OutlookWorkspaceLayout";
import { DataTable } from "@/shared/ui/data/DataTable";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { contentText } from "@/shared/ui/typography";

/** Preserves the result-and-editing layout while the first outlook is being prepared. */
export function OutlookLoading() {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-6" role="status">
      <span className="sr-only">見通しを読み込み中</span>
      <div className="@container/outlook-people grid max-w-2xl min-w-0 grid-cols-1 gap-1">
        <div className="grid min-w-0 grid-cols-1 gap-4 @xs/outlook-people:grid-cols-2">
          {["focus", "rival"].map((role) => (
            <div key={role} className="grid min-w-0 grid-cols-1 gap-2">
              <Skeleton className="h-5 w-24 max-w-full" />
              <Skeleton className="h-11 rounded-sm pointer-fine:h-10" />
            </div>
          ))}
        </div>
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <OutlookWorkspaceLayout
        chart={
          <div className="grid min-w-0 grid-cols-1 gap-4">
            <div className="grid max-w-2xl min-w-0 grid-cols-1 gap-2">
              <Skeleton className="h-5 w-52 max-w-full" />
              <Skeleton className="h-7 w-4/5" />
            </div>
            <div className="grid min-w-0 grid-cols-1 gap-2">
              <div className="grid min-w-0 grid-cols-1 gap-2">
                <div className="grid min-w-0 grid-cols-1 gap-1">
                  <Skeleton className="h-5 w-36 max-w-full" />
                  <Skeleton className="h-4 w-64 max-w-full" />
                </div>
                <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-[7rem_minmax(0,1fr)]">
                  <div className="grid min-w-0 grid-cols-1 gap-2">
                    <Skeleton className="h-5 w-16" />
                    <div className="grid min-w-0 grid-cols-1 gap-1">
                      <Skeleton className="h-11 w-28 rounded-sm pointer-fine:h-10" />
                      <Skeleton className="h-4 w-20" />
                    </div>
                  </div>
                  <div className="grid min-w-0 grid-cols-1 gap-2 self-start">
                    <Skeleton className="h-11 w-36 max-w-full rounded-sm pointer-fine:h-9" />
                    <Skeleton className="h-4 w-52 max-w-full" />
                  </div>
                </div>
                <div className="grid min-w-0 grid-cols-1 gap-2">
                  <Skeleton className="h-5 w-20" />
                  <div className="grid min-w-0 grid-cols-1 gap-1">
                    <Skeleton className="h-5 w-32 max-w-full" />
                    <Skeleton className="h-5 w-24 max-w-full" />
                    <Skeleton className="h-5 w-24 max-w-full" />
                  </div>
                </div>
                <Skeleton className="h-[270px] w-full" />
                <Skeleton className="h-4 w-96 max-w-full" />
                <Skeleton className="h-4 w-72 max-w-full" />
              </div>
              <div className="min-w-0">
                <div className="flex min-h-11 items-center gap-2 px-2">
                  <Skeleton className="size-4" />
                  <Skeleton className="h-5 w-32 max-w-full" />
                </div>
                <div className="mt-1 min-w-0 pl-8">
                  <p className={contentText.supporting}>
                    <Skeleton as="span" className="text-transparent">
                      3つの展開例を重ねます。確率や上下限を示すものではありません。
                    </Skeleton>
                  </p>
                </div>
              </div>
            </div>
          </div>
        }
        editor={
          <div className="grid min-w-0 grid-cols-1 gap-2">
            <Skeleton className="h-5 w-28 max-w-full" />
            <div className="grid min-w-0 grid-cols-1 gap-4">
              <div className="flex flex-wrap gap-2">
                {["focus", "rival"].map((role) => (
                  <Skeleton
                    key={role}
                    className="h-15 w-28 max-w-full rounded-sm pointer-fine:h-13"
                  />
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <Skeleton className="h-11 w-26 rounded-sm pointer-fine:h-9" />
                <Skeleton className="h-11 w-34 max-w-full rounded-sm pointer-fine:h-9" />
              </div>
              <div className="flex overflow-hidden">
                {["mean", "counts"].map((method) => (
                  <Skeleton
                    key={method}
                    className="h-11 w-32 shrink-0 rounded-sm pointer-fine:h-9"
                  />
                ))}
              </div>
              <div className="grid min-w-0 grid-cols-1 gap-2">
                <div className="grid min-w-0 grid-cols-1 gap-2">
                  <Skeleton className="h-5 w-52 max-w-full" />
                  <div className="grid min-w-0 grid-cols-1 gap-1">
                    <div className="grid min-w-0 grid-cols-1 gap-2">
                      <Skeleton className="h-11 rounded-sm pointer-fine:h-10" />
                      <div className="flex h-11 items-center">
                        <Skeleton className="h-2 w-full rounded-full" />
                      </div>
                    </div>
                    <p className={contentText.supporting}>
                      <Skeleton as="span" className="text-transparent">
                        小さいほど上位。1.00〜4.00位で調整できます。
                      </Skeleton>
                    </p>
                  </div>
                </div>
                <Skeleton className="h-4 w-24 max-w-full" />
              </div>
            </div>
          </div>
        }
        results={
          <div className="grid min-w-0 grid-cols-1 gap-4">
            <Skeleton className="h-5 w-40 max-w-full" />
            <div aria-hidden="true" className="min-w-0" inert>
              <DataTable
                caption={{ content: "総合平均順位の変化", visibility: "screen-reader" }}
                density="compact"
                layout="fixed"
                minWidth="20rem"
                verticalAlign="top"
                rows={["now", "custom", "fifty", "hundred"]}
                getRowKey={(row) => row}
                columns={[
                  {
                    key: "horizon",
                    header: <Skeleton className="h-4 w-16 max-w-full" />,
                    rowHeader: true,
                    width: "8rem",
                    renderCell: (row) =>
                      row === "custom" ? (
                        <div className="grid min-w-0 grid-cols-1 gap-1">
                          <Skeleton className="h-4 w-20 max-w-full" />
                          <Skeleton className="h-5 w-16 max-w-full" />
                        </div>
                      ) : (
                        <Skeleton className="h-5 w-16 max-w-full" />
                      ),
                  },
                  ...["focus", "rival"].map((key) => ({
                    key,
                    header: <Skeleton className="h-5 w-16 max-w-full" />,
                    renderCell: () => <Skeleton className="h-5 w-12 max-w-full" />,
                  })),
                ]}
              />
            </div>
          </div>
        }
      />
      <div className="grid min-w-0 grid-cols-1 gap-4">
        <Skeleton className="h-5 w-36 max-w-full" />
        <Skeleton className="h-11 w-60 max-w-full rounded-sm pointer-fine:h-9" />
        <Skeleton className="h-5 w-80 max-w-full" />
      </div>
    </div>
  );
}
