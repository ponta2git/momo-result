import { formatRational, projectOutlook } from "@/features/seriesComparison/model/outlook";
import type { CumulativePair } from "@/features/seriesComparison/model/outlook";
import { outlookGapText } from "@/features/seriesComparison/outlook/outlookComparison";
import type { OutlookComparison } from "@/features/seriesComparison/outlook/outlookComparison";
import type { OutlookSession } from "@/features/seriesComparison/outlook/outlookSession";
import { orderFixedMembers } from "@/shared/domain/members";
import { MemberSequenceLabel } from "@/shared/matches/MemberSequenceLabel";
import { cn } from "@/shared/ui/cn";
import { DataTable } from "@/shared/ui/data/DataTable";
import { contentText } from "@/shared/ui/typography";

/** The selected horizon and fixed comparisons keep stable row identities. */
export function OutlookResults({
  cumulative,
  names,
  memberIds,
  session,
  comparison,
}: {
  cumulative: CumulativePair;
  names: readonly [string, string];
  memberIds: readonly [string, string];
  session: OutlookSession;
  comparison: OutlookComparison;
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
  const before = comparison
    ? projectOutlook(
        cumulative,
        comparison.before[0].distribution,
        comparison.before[1].distribution,
        session.horizon,
      )
    : null;
  return (
    <section className="grid min-w-0 gap-4" aria-labelledby="outlook-results-heading">
      <h3 id="outlook-results-heading" className={contentText.heading}>
        総合平均順位の変化
      </h3>
      <div className="grid min-w-0 gap-1" aria-label={`${session.horizon}戦後の差`}>
        <p className={contentText.body}>{session.horizon}戦後の差</p>
        {before ? (
          <p className={cn(contentText.body, "tabular-nums")}>
            <span aria-hidden="true">○ </span>変更前：{outlookGapText(before.gap, names)}
          </p>
        ) : null}
        <p className={cn(contentText.body, "tabular-nums")}>
          <span aria-hidden="true" className="text-[var(--color-analysis-emphasis)]">
            ●{" "}
          </span>
          試している成績：{outlookGapText(selected.gap, names)}
        </p>
      </div>
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
