import { useId, useState } from "react";

import type { OutlookSession } from "@/features/seriesComparison/outlook/outlookSession";
import { InputControl } from "@/shared/ui/forms/Control";
import { buildFieldDescribedBy, Field } from "@/shared/ui/forms/Field";

export function parseOutlookHorizon(text: string) {
  const value = Number(text);
  return /^\d+$/u.test(text) && value >= 1 && value <= 1000 ? value : undefined;
}

/** One horizon controls the point on the chart, the result, and the required performance. */
export function OutlookHorizonControl({
  horizon,
  horizonText,
  change,
}: {
  horizon: number;
  horizonText: string;
  change: (update: (current: OutlookSession) => OutlookSession) => void;
}) {
  const id = useId();
  const [validateBlank, setValidateBlank] = useState(false);
  const blank = horizonText === "";
  const valid = parseOutlookHorizon(horizonText) !== undefined;
  const showError = !valid && (!blank || validateBlank);
  const descriptionId = showError ? undefined : `${id}-description`;
  const errorId = showError ? `${id}-error` : undefined;
  return (
    <div data-outlook-preserve-draft>
      <Field
        label="何戦後"
        htmlFor={id}
        description={showError ? undefined : blank ? `結果は${horizon}戦後` : "1〜1000戦"}
        descriptionId={descriptionId}
        error={
          showError
            ? `1〜1000の整数を入力してください。結果は${horizon}戦後のままです。`
            : undefined
        }
        errorId={errorId}
      >
        <div className="max-w-28">
          <InputControl
            id={id}
            inputMode="numeric"
            invalid={showError}
            value={horizonText}
            aria-describedby={buildFieldDescribedBy(descriptionId, errorId)}
            onChange={(event) => {
              const text = event.target.value;
              setValidateBlank(false);
              const next = parseOutlookHorizon(text);
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
                change((current) => ({ ...current, horizonText: String(current.horizon) }));
              }
            }}
          />
        </div>
      </Field>
    </div>
  );
}
