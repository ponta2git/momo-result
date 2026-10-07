import { formatRational, projectOutlook } from "@/features/seriesComparison/model/outlook";
import type { CumulativePair } from "@/features/seriesComparison/model/outlook";
import type { OutlookSession } from "@/features/seriesComparison/outlook/outlookSession";
import { orderFixedMembers } from "@/shared/domain/members";
import { MemberSequenceLabel } from "@/shared/matches/MemberSequenceLabel";
import { DataTable } from "@/shared/ui/data/DataTable";
import { contentText } from "@/shared/ui/typography";

/** The selected horizon and fixed comparisons keep stable row identities. */
export function OutlookResults({
  cumulative,
  names,
  memberIds,
  session,
}: {
  cumulative: CumulativePair;
  names: readonly [string, string];
  memberIds: readonly [string, string];
  session: OutlookSession;
}) {
  const members = orderFixedMembers(
    memberIds.map((memberId, role) => ({ memberId, role: role as 0 | 1 })),
  );
  const selected = projectOutlook(
    cumulative,
    session.entries[0].distribution,
    session.entries[1].distribution,
    session.horizon,
  );
  const rows = [
    { key: "now", h: 0 },
    { key: "custom", h: session.horizon },
    { key: "fifty", h: 50 },
    { key: "hundred", h: 100 },
  ].map((row) => ({
    ...row,
    ...(row.key === "custom"
      ? selected
      : projectOutlook(
          cumulative,
          session.entries[0].distribution,
          session.entries[1].distribution,
          row.h,
        )),
  }));
  return (
    <section className="grid min-w-0 gap-4" aria-labelledby="outlook-results-heading">
      <h3 id="outlook-results-heading" className={contentText.heading}>
        総合平均順位の変化
      </h3>
      <DataTable
        caption={{ content: "現在とこの先の総合平均順位", visibility: "screen-reader" }}
        density="compact"
        layout="fixed"
        minWidth="20rem"
        verticalAlign="top"
        rows={rows}
        getRowKey={(row) => row.key}
        columns={[
          {
            key: "h",
            header: "時点",
            rowHeader: true,
            width: "8rem",
            renderCell: (row) =>
              row.key === "custom" ? (
                <div className="grid gap-1">
                  <span className={contentText.supporting}>指定した戦数</span>
                  <span>
                    <span aria-hidden="true" className="text-[var(--color-analysis-emphasis)]">
                      ●{" "}
                    </span>
                    {row.h}戦後
                  </span>
                </div>
              ) : row.h === 0 ? (
                "現在"
              ) : (
                `${row.h}戦後`
              ),
          },
          ...members.map(({ memberId, role }) => ({
            key: memberId,
            header: <MemberSequenceLabel memberId={memberId}>{names[role]}</MemberSequenceLabel>,
            tabular: true,
            renderCell: (row: (typeof rows)[number]) =>
              `${formatRational(role === 0 ? row.focusAverage : row.rivalAverage, 2)}位`,
          })),
        ]}
      />
    </section>
  );
}
