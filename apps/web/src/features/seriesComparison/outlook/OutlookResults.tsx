import { useId } from "react";

import { formatRational, projectOutlook } from "@/features/seriesComparison/model/outlook";
import type { CumulativePair } from "@/features/seriesComparison/model/outlook";
import type { OutlookSession } from "@/features/seriesComparison/outlook/outlookSession";
import { DataTable } from "@/shared/ui/data/DataTable";
import { InputControl } from "@/shared/ui/forms/Control";
import { Field } from "@/shared/ui/forms/Field";
import { contentText } from "@/shared/ui/typography";

/** The editable row keeps its identity while the comparison horizon changes. */
export function OutlookResults({
  cumulative,
  names,
  session,
  change,
}: {
  cumulative: CumulativePair;
  names: readonly [string, string];
  session: OutlookSession;
  change: (update: (current: OutlookSession) => OutlookSession) => void;
}) {
  const horizonId = useId();
  const valid =
    /^\d+$/u.test(session.horizonText) &&
    Number(session.horizonText) >= 1 &&
    Number(session.horizonText) <= 1000;
  const rows = [
    { key: "now", h: 0 },
    { key: "custom", h: session.horizon },
    { key: "fifty", h: 50 },
    { key: "hundred", h: 100 },
  ].map((row) => ({
    ...row,
    ...projectOutlook(
      cumulative,
      session.entries[0].distribution,
      session.entries[1].distribution,
      row.h,
    ),
  }));
  return (
    <section className="grid min-w-0 gap-2" aria-labelledby="outlook-results-heading">
      <h3 id="outlook-results-heading" className={contentText.heading}>
        総合平均順位の変化
      </h3>
      <DataTable
        caption={{ content: "現在とこの先の総合平均順位", visibility: "screen-reader" }}
        density="compact"
        rows={rows}
        getRowKey={(row) => row.key}
        columns={[
          {
            key: "h",
            header: "時点",
            rowHeader: true,
            width: "38%",
            renderCell: (row) =>
              row.key === "custom" ? (
                <div className="max-w-28">
                  <Field label="何戦後" htmlFor={horizonId}>
                    <InputControl
                      id={horizonId}
                      inputMode="numeric"
                      invalid={!valid}
                      value={session.horizonText}
                      aria-describedby="outlook-horizon-help"
                      onChange={(event) => {
                        const text = event.target.value;
                        const next =
                          /^\d+$/u.test(text) && Number(text) >= 1 && Number(text) <= 1000
                            ? Number(text)
                            : undefined;
                        change((current) => ({
                          ...current,
                          horizonText: text,
                          ...(next === undefined ? {} : { horizon: next }),
                        }));
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Escape")
                          change((current) => ({
                            ...current,
                            horizonText: String(current.horizon),
                          }));
                      }}
                    />
                  </Field>
                </div>
              ) : row.h === 0 ? (
                "現在"
              ) : (
                `${row.h}戦後`
              ),
          },
          {
            key: "focus",
            header: names[0],
            tabular: true,
            renderCell: (row) => `${formatRational(row.focusAverage, 2)}位`,
          },
          {
            key: "rival",
            header: names[1],
            tabular: true,
            renderCell: (row) => `${formatRational(row.rivalAverage, 2)}位`,
          },
        ]}
      />
      <p
        id="outlook-horizon-help"
        className={contentText.supporting}
        role={valid ? undefined : "alert"}
      >
        {valid
          ? "1〜1000戦で指定できます。"
          : `1〜1000の整数を入力してください。結果は${session.horizon}戦後のままです。`}
      </p>
    </section>
  );
}
