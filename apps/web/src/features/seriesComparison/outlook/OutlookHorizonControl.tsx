import { useId, useState } from "react";
import type { ReactNode } from "react";

import { cn } from "@/shared/ui/cn";
import { InputControl } from "@/shared/ui/forms/Control";
import { buildFieldDescribedBy, Field } from "@/shared/ui/forms/Field";
import { fieldText } from "@/shared/ui/typography";

export function parseOutlookHorizon(text: string) {
  const value = Number(text);
  return /^\d+$/u.test(text) && value >= 1 && value <= 1000 ? value : undefined;
}

/** Keep unfinished text separate from the last valid horizon for each task. */
export function OutlookHorizonControl({
  horizon,
  horizonText,
  onChange,
  label = "何戦後を見る",
  rangeControl,
}: {
  horizon: number;
  horizonText: string;
  onChange: (selection: { horizon: number; horizonText: string }) => void;
  label?: string;
  rangeControl?: ReactNode;
}) {
  const id = useId();
  const [validateBlank, setValidateBlank] = useState(false);
  const blank = horizonText === "";
  const valid = parseOutlookHorizon(horizonText) !== undefined;
  const showError = !valid && (!blank || validateBlank);
  const descriptionId = showError ? undefined : `${id}-description`;
  const errorId = showError ? `${id}-error` : undefined;
  return (
    <div className="grid min-w-0 gap-1" data-outlook-preserve-draft>
      <div className={rangeControl ? "grid min-w-0 grid-cols-2 gap-4" : undefined}>
        <Field label={label} htmlFor={id}>
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
                onChange({
                  horizonText: text,
                  horizon: next ?? horizon,
                });
              }}
              onBlur={() => setValidateBlank(true)}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === "Enter") setValidateBlank(true);
                if (event.key === "Escape") {
                  setValidateBlank(false);
                  onChange({ horizon, horizonText: String(horizon) });
                }
              }}
            />
          </div>
        </Field>
        {rangeControl}
      </div>
      <p
        id={errorId ?? descriptionId}
        className={cn(showError ? fieldText.error : fieldText.description, "min-h-10")}
        role={showError ? "alert" : undefined}
      >
        {showError
          ? `1〜1000の整数で入力してください（現在は${horizon}戦後を表示）。`
          : blank
            ? `結果は${horizon}戦後`
            : rangeControl
              ? "1〜1000戦。グラフの範囲外は表で確認できます。"
              : "1〜1000戦"}
      </p>
    </div>
  );
}
