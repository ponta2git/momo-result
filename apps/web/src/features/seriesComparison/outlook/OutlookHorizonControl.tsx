import { useId, useState } from "react";

import { InputControl } from "@/shared/ui/forms/Control";
import { buildFieldDescribedBy, Field } from "@/shared/ui/forms/Field";

export function parseOutlookHorizon(text: string, max = 1000) {
  const value = Number(text);
  return /^\d+$/u.test(text) && value >= 1 && value <= max ? value : undefined;
}

/** Keep unfinished text separate from the last valid horizon for each task. */
export function OutlookHorizonControl({
  horizon,
  horizonText,
  onChange,
  label = "何戦後を見る",
  max = 1000,
}: {
  horizon: number;
  horizonText: string;
  onChange: (selection: { horizon: number; horizonText: string }) => void;
  label?: string;
  max?: number;
}) {
  const id = useId();
  const [validateBlank, setValidateBlank] = useState(false);
  const blank = horizonText === "";
  const valid = parseOutlookHorizon(horizonText, max) !== undefined;
  const showError = !valid && (!blank || validateBlank);
  const descriptionId = showError ? undefined : `${id}-description`;
  const errorId = showError ? `${id}-error` : undefined;
  return (
    <div data-outlook-preserve-draft>
      <Field
        label={label}
        htmlFor={id}
        description={showError ? undefined : blank ? `結果は${horizon}戦後` : `1〜${max}戦`}
        descriptionId={descriptionId}
        error={
          showError
            ? `1〜${max}の整数を入力してください。結果は${horizon}戦後のままです。`
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
              const next = parseOutlookHorizon(text, max);
              onChange({
                horizonText: text,
                horizon: next ?? horizon,
              });
            }}
            onBlur={() => setValidateBlank(true)}
            onKeyDown={(event) => {
              if (event.key === "Enter") setValidateBlank(true);
              if (event.key === "Escape") {
                setValidateBlank(false);
                onChange({ horizon, horizonText: String(horizon) });
              }
            }}
          />
        </div>
      </Field>
    </div>
  );
}
