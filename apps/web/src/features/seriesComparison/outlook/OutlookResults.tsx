import { useId, useState } from "react";

import { formatRational, projectOutlook } from "@/features/seriesComparison/model/outlook";
import type { CumulativePair } from "@/features/seriesComparison/model/outlook";
import type { OutlookSession } from "@/features/seriesComparison/outlook/outlookSession";
import { orderFixedMembers } from "@/shared/domain/members";
import { MemberSequenceLabel } from "@/shared/matches/MemberSequenceLabel";
import { DataTable } from "@/shared/ui/data/DataTable";
import { InputControl } from "@/shared/ui/forms/Control";
import { buildFieldDescribedBy, Field } from "@/shared/ui/forms/Field";
import { contentText } from "@/shared/ui/typography";

/** The editable row keeps its identity while the comparison horizon changes. */
export function OutlookResults({
  cumulative,
  names,
  memberIds,
  session,
  change,
}: {
  cumulative: CumulativePair;
  names: readonly [string, string];
  memberIds: readonly [string, string];
  session: OutlookSession;
  change: (update: (current: OutlookSession) => OutlookSession) => void;
}) {
  const horizonId = useId();
  const [validateBlank, setValidateBlank] = useState(false);
  const blank = session.horizonText === "";
  const valid =
    /^\d+$/u.test(session.horizonText) &&
    Number(session.horizonText) >= 1 &&
    Number(session.horizonText) <= 1000;
  const showError = !valid && (!blank || validateBlank);
  const descriptionId = showError ? undefined : `${horizonId}-description`;
  const errorId = showError ? `${horizonId}-error` : undefined;
  const members = orderFixedMembers(
    memberIds.map((memberId, role) => ({ memberId, role: role as 0 | 1 })),
  );
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
                <Field
                  label="何戦後"
                  htmlFor={horizonId}
                  description={
                    showError ? undefined : blank ? `結果は${session.horizon}戦後` : "1〜1000戦"
                  }
                  descriptionId={descriptionId}
                  error={
                    showError
                      ? `1〜1000の整数を入力してください。結果は${session.horizon}戦後のままです。`
                      : undefined
                  }
                  errorId={errorId}
                >
                  <div className="max-w-28">
                    <InputControl
                      id={horizonId}
                      inputMode="numeric"
                      invalid={showError}
                      value={session.horizonText}
                      aria-describedby={buildFieldDescribedBy(descriptionId, errorId)}
                      onChange={(event) => {
                        const text = event.target.value;
                        setValidateBlank(false);
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
                      onBlur={() => setValidateBlank(true)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") setValidateBlank(true);
                        if (event.key === "Escape") {
                          setValidateBlank(false);
                          change((current) => ({
                            ...current,
                            horizonText: String(current.horizon),
                          }));
                        }
                      }}
                    />
                  </div>
                </Field>
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
