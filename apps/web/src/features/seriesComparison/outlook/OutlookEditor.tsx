import { ArrowRight, Minus, Plus, X } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import {
  countsFromMean,
  countsPerTwenty,
  distributionFromCounts,
  distributionsEqual,
  exactWholeCounts,
  nearestWholeCounts,
  wholeCountCapacities,
  distributionMean,
  formatRational,
  meanInput,
  meanLimits,
  nextMeanHundredths,
  rationalToNumber,
} from "@/features/seriesComparison/model/outlook";
import { outlookAverage } from "@/features/seriesComparison/outlook/outlookPresentation";
import {
  applyOutlookDistribution,
  beginOutlookGesture,
  finishOutlookGesture,
  otherRole,
  updateOutlookEntry,
} from "@/features/seriesComparison/outlook/outlookSession";
import type {
  OutlookSession,
  OutlookRankIndex,
} from "@/features/seriesComparison/outlook/outlookSession";
import { Button } from "@/shared/ui/actions/Button";
import { IconButton } from "@/shared/ui/actions/IconButton";
import { cn } from "@/shared/ui/cn";
import { InputControl } from "@/shared/ui/forms/Control";
import { buildFieldDescribedBy, Field } from "@/shared/ui/forms/Field";
import { SelectField } from "@/shared/ui/forms/SelectField";
import { contentText } from "@/shared/ui/typography";

const rangeClass =
  "block min-h-11 w-full cursor-pointer accent-[var(--color-action)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-action)] disabled:cursor-not-allowed disabled:opacity-50";
const rangeKeys = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowDown",
  "ArrowUp",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);
type Props = {
  session: OutlookSession;
  role: 0 | 1;
  method: "mean" | "counts";
  name: string;
  label?: ReactNode;
  change: (update: (session: OutlookSession) => OutlookSession) => void;
};

export function OutlookEditor({ session, role, method, name, label, change }: Props) {
  const entry = session.entries[role];
  const meanPending = entry.meanDraft !== undefined || entry.error !== undefined;
  const opponent = session.entries[otherRole(role)].distribution;
  const currentMean = distributionMean(entry.distribution);
  const limits = meanLimits(opponent);
  const sliderId = useId();
  const meanId = `${sliderId}-mean`;
  const meanInputRef = useRef<HTMLInputElement>(null);
  const descriptionId = `${meanId}-description`;
  const errorId = entry.error ? `${meanId}-error` : undefined;
  const setMean = (hundredths: number) =>
    change((current) => {
      const start =
        current.gesture?.before[role].distribution ?? current.entries[role].distribution;
      const startMean = distributionMean(start);
      if (startMean.numerator * 100n === BigInt(hundredths) * startMean.denominator) {
        return applyOutlookDistribution(
          current,
          role,
          start,
          current.gesture?.before[role].source ?? current.entries[role].source,
        );
      }
      const distribution = countsFromMean(
        hundredths,
        current.entries[otherRole(role)].distribution,
        start,
      );
      return distribution
        ? applyOutlookDistribution(current, role, distribution, { kind: "average" })
        : updateOutlookEntry(current, role, {
            error: "この平均は相手の成績と両立しません。設定できる範囲で調整してください。",
          });
    });
  const begin = () => change((current) => beginOutlookGesture(current, role));
  const finish = (cancel = false) => change((current) => finishOutlookGesture(current, cancel));
  const cancelMean = () => {
    change((current) =>
      updateOutlookEntry(current, role, { meanDraft: undefined, error: undefined }),
    );
    meanInputRef.current?.focus({ preventScroll: true });
  };
  const commitMean = () =>
    change((current) => {
      const edited = current.entries[role];
      if (edited.meanDraft === undefined) return current;
      const mean = distributionMean(edited.distribution);
      if (edited.meanDraft === formatRational(mean, 4))
        return updateOutlookEntry(current, role, { meanDraft: undefined, error: undefined });
      const input = meanInput(edited.meanDraft, mean);
      if (input.kind === "unchanged")
        return updateOutlookEntry(current, role, { meanDraft: undefined, error: undefined });
      if (input.kind === "invalid")
        return updateOutlookEntry(current, role, {
          error: "平均順位は1.00〜4.00の範囲で、0.01刻みで入力してください。",
        });
      const distribution = countsFromMean(
        input.hundredths,
        current.entries[otherRole(role)].distribution,
        edited.distribution,
      );
      return distribution
        ? applyOutlookDistribution(current, role, distribution, { kind: "average" })
        : updateOutlookEntry(current, role, {
            error:
              "この平均は相手の成績と両立しません。相手の指定は変えず、入力を見直してください。",
          });
    });
  return (
    <div className="grid min-w-0 gap-2">
      {method === "mean" ? (
        <Field
          htmlFor={meanId}
          label={label ?? `${name}のこれからの平均順位`}
          description={
            <span className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-2 tabular-nums">
              <span>
                {(limits.minimumHundredths / 100).toFixed(2)}〜
                {(limits.maximumHundredths / 100).toFixed(2)}位
              </span>
              <span className={meanPending ? undefined : "invisible"}>
                反映済み {outlookAverage(currentMean)}位
              </span>
            </span>
          }
          descriptionId={descriptionId}
          error={entry.error}
          errorId={errorId}
        >
          <div className="grid gap-2">
            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2">
              <InputControl
                ref={meanInputRef}
                id={meanId}
                aria-label={`${name}のこれからの平均順位`}
                inputMode="decimal"
                invalid={Boolean(entry.error)}
                aria-describedby={buildFieldDescribedBy(descriptionId, errorId)}
                value={
                  entry.meanDraft ?? formatRational(currentMean, 4).replace(/(\.\d\d)0+$/u, "$1")
                }
                onChange={(event) => {
                  const text = event.target.value;
                  change((current) =>
                    updateOutlookEntry(current, role, {
                      meanDraft: text,
                      error: undefined,
                    }),
                  );
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commitMean();
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    cancelMean();
                  }
                }}
              />
              <span className={meanPending ? undefined : "invisible"}>
                <IconButton
                  variant="quiet"
                  size="sm"
                  icon={<X />}
                  aria-label={`${name}の入力を取り消す`}
                  disabled={!meanPending}
                  onClick={cancelMean}
                />
              </span>
              <Button
                size="sm"
                variant="secondary"
                disabled={entry.meanDraft === undefined}
                aria-label={`${name}の平均順位を反映`}
                onClick={commitMean}
              >
                反映
              </Button>
            </div>
            <div>
              <label htmlFor={sliderId} className="sr-only">
                {name}の平均順位を動かす
              </label>
              <input
                id={sliderId}
                aria-describedby={buildFieldDescribedBy(descriptionId, errorId)}
                type="range"
                className={rangeClass}
                min={Math.min(limits.minimumHundredths / 100, rationalToNumber(currentMean))}
                max={Math.max(limits.maximumHundredths / 100, rationalToNumber(currentMean))}
                step="any"
                value={rationalToNumber(currentMean)}
                aria-valuetext={`${outlookAverage(currentMean)}位。小さいほど良い成績`}
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId);
                  begin();
                }}
                onPointerUp={() => finish()}
                onPointerCancel={() => finish(true)}
                onBlur={() => finish()}
                onChange={(event) => setMean(Math.round(Number(event.target.value) * 100))}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    finish(true);
                    return;
                  }
                  if (!rangeKeys.has(event.key)) return;
                  event.preventDefault();
                  begin();
                  const value =
                    event.key === "Home"
                      ? limits.minimumHundredths
                      : event.key === "End"
                        ? limits.maximumHundredths
                        : nextMeanHundredths(
                            currentMean,
                            ["ArrowLeft", "ArrowDown", "PageDown"].includes(event.key) ? -1 : 1,
                            opponent,
                          );
                  if (value !== null) setMean(value);
                }}
                onKeyUp={(event) => {
                  if (rangeKeys.has(event.key)) finish();
                }}
              />
            </div>
          </div>
        </Field>
      ) : (
        <WholeCountEditor
          session={session}
          role={role}
          method={method}
          name={name}
          change={change}
        />
      )}
    </div>
  );
}

/** Move games between two named ranks; every accepted input is a complete distribution. */
function WholeCountEditor({ session, role, name, change }: Props) {
  const entry = session.entries[role];
  const opponent = session.entries[otherRole(role)].distribution;
  const [gain, lose] = session.transfer;
  const { exact, counts } = useMemo(() => {
    const wholeCounts = exactWholeCounts(entry.distribution);
    return {
      exact: wholeCounts,
      counts: wholeCounts ?? nearestWholeCounts(entry.distribution, opponent),
    };
  }, [entry.distribution, opponent]);
  const [wholeStart] = useState(() =>
    exact || !counts ? undefined : { counts, mean: distributionMean(entry.distribution) },
  );
  const capacity = wholeCountCapacities(opponent);
  const total = counts ? counts[gain] + counts[lose] : 0;
  const minimum = Math.max(0, total - capacity[lose]);
  const maximum = Math.min(capacity[gain], total);
  const sliderId = useId();
  const countId = `${sliderId}-count`;
  const descriptionId = `${countId}-description`;
  const errorId = entry.error ? `${countId}-error` : undefined;
  const roundingId = wholeStart ? `${countId}-rounding` : undefined;
  const [text, setText] = useState<string>();
  const begin = () => change((current) => beginOutlookGesture(current, role));
  const finish = (cancel = false) => change((current) => finishOutlookGesture(current, cancel));
  const transfer = (value: number) =>
    change((current) => {
      const origin =
        current.gesture?.before[role].distribution ?? current.entries[role].distribution;
      const other = current.entries[otherRole(role)].distribution;
      const base = exactWholeCounts(origin) ?? nearestWholeCounts(origin, other);
      if (!base || !Number.isInteger(value)) return current;
      const limits = wholeCountCapacities(other);
      const pairTotal = base[gain] + base[lose];
      const next = [...base];
      next[gain] = value;
      next[lose] = pairTotal - value;
      if (
        next[gain] < 0 ||
        next[lose] < 0 ||
        next[gain] > limits[gain] ||
        next[lose] > limits[lose]
      )
        return updateOutlookEntry(current, role, {
          error: `${gain + 1}位は${Math.max(0, pairTotal - limits[lose])}〜${Math.min(limits[gain], pairTotal)}回で指定してください。`,
        });
      if (value === base[gain])
        return distributionsEqual(current.entries[role].distribution, origin) || !current.gesture
          ? updateOutlookEntry(current, role, { error: undefined })
          : applyOutlookDistribution(current, role, origin, current.gesture.before[role].source);
      return applyOutlookDistribution(current, role, distributionFromCounts(next), {
        kind: "counts",
      });
    });
  if (!counts)
    return (
      <p className={contentText.body}>
        相手の成績と両立する20回の配分がありません。平均順位で調整してください。
      </p>
    );
  const currentCounts = countsPerTwenty(entry.distribution);
  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <p className={contentText.heading}>20戦あたりの回数</p>
        {wholeStart ? <p className={contentText.supporting}>現在の内訳</p> : null}
        <dl className="grid grid-cols-4 gap-2" aria-label={`${name}の順位内訳`}>
          {currentCounts.map((value, i) => (
            <div key={i} className="grid gap-1 text-center">
              <dt className={contentText.supporting}>{i + 1}位</dt>
              <dd className={cn(contentText.body, "grid gap-1 tabular-nums")}>
                <span>
                  {value.denominator === 1n ? String(value.numerator) : formatRational(value, 2)}回
                </span>
                <div
                  className="h-1.5 overflow-hidden rounded-xs bg-[var(--color-surface-subtle)]"
                  aria-hidden="true"
                >
                  <div
                    className="h-full bg-[var(--color-series-1)]"
                    style={{ width: `${rationalToNumber(value) * 5}%` }}
                  />
                </div>
              </dd>
            </div>
          ))}
        </dl>
        {wholeStart ? (
          <div className="grid gap-2" id={roundingId}>
            <p className={contentText.supporting}>開始時の整数配分</p>
            <dl className="grid grid-cols-4 gap-2" aria-label={`${name}の開始時の整数配分`}>
              {([0, 1, 2, 3] as const).map((rank) => (
                <div key={rank} className="text-center">
                  <dt className="sr-only">{rank + 1}位</dt>
                  <dd className={cn(contentText.body, "tabular-nums")}>
                    {wholeStart.counts[rank]}回
                  </dd>
                </div>
              ))}
            </dl>
            <p className={cn(contentText.supporting, "tabular-nums")}>
              平均{outlookAverage(wholeStart.mean)}→
              {outlookAverage(distributionMean(distributionFromCounts(wholeStart.counts)))}位
            </p>
          </div>
        ) : null}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-2">
        {([lose, gain] as const).map((rank, index) => (
          <div key={index} className={index === 0 ? "contents" : "min-w-0"}>
            <SelectField
              label={index === 0 ? "減らす順位" : "増やす順位"}
              value={String(rank)}
              options={[0, 1, 2, 3].map((value) => ({
                value: String(value),
                label: `${value + 1}位`,
                disabled: value === (index === 0 ? gain : lose),
              }))}
              onValueChange={(value) => {
                setText(undefined);
                change((current) => ({
                  ...updateOutlookEntry(finishOutlookGesture(current), role, { error: undefined }),
                  transfer: (index === 0 ? [gain, Number(value)] : [Number(value), lose]) as [
                    OutlookRankIndex,
                    OutlookRankIndex,
                  ],
                }));
              }}
            />
            {index === 0 ? (
              <span
                className="flex h-11 items-center text-[var(--color-text-secondary)] pointer-fine:h-10"
                aria-hidden="true"
              >
                <ArrowRight className="size-4" />
              </span>
            ) : null}
          </div>
        ))}
      </div>
      <div className="grid gap-2">
        <Field
          label={`${name}の${gain + 1}位の回数`}
          htmlFor={countId}
          description={
            minimum === maximum
              ? `この順位の組み合わせでは${minimum}回から動かせません。`
              : `相手と両立する範囲は${minimum}〜${maximum}回です。`
          }
          descriptionId={descriptionId}
          error={entry.error}
          errorId={errorId}
        >
          <div className="grid gap-2">
            <div className="flex items-center gap-1">
              <IconButton
                variant="secondary"
                size="sm"
                icon={<Minus />}
                aria-label={`${gain + 1}位から${lose + 1}位へ1回移す`}
                aria-describedby={roundingId}
                disabled={counts[gain] <= minimum}
                onClick={() => {
                  setText(undefined);
                  transfer(counts[gain] - 1);
                }}
              />
              <InputControl
                id={countId}
                inputMode="numeric"
                invalid={Boolean(entry.error)}
                aria-describedby={buildFieldDescribedBy(descriptionId, errorId, roundingId)}
                value={text ?? String(counts[gain])}
                onChange={(event) => {
                  const value = event.target.value;
                  setText(value);
                  if (
                    /^\d+$/u.test(value) &&
                    Number(value) >= minimum &&
                    Number(value) <= maximum
                  ) {
                    begin();
                    transfer(Number(value));
                  } else
                    change((current) =>
                      updateOutlookEntry(current, role, {
                        error: `${minimum}〜${maximum}の整数を入力してください。`,
                      }),
                    );
                }}
                onBlur={(event) => {
                  if (entry.error) return;
                  const target = event.relatedTarget;
                  if (
                    target instanceof HTMLElement &&
                    target.closest("[data-outlook-preserve-draft]")
                  )
                    return;
                  setText(undefined);
                  change((current) =>
                    updateOutlookEntry(finishOutlookGesture(current), role, { error: undefined }),
                  );
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === "Escape") {
                    event.preventDefault();
                    if (event.key === "Enter" && entry.error) return;
                    setText(undefined);
                    const cancel = event.key === "Escape";
                    change((current) =>
                      updateOutlookEntry(finishOutlookGesture(current, cancel), role, {
                        error: undefined,
                      }),
                    );
                  }
                }}
              />
              <IconButton
                variant="secondary"
                size="sm"
                icon={<Plus />}
                aria-label={`${lose + 1}位から${gain + 1}位へ1回移す`}
                aria-describedby={roundingId}
                disabled={counts[gain] >= maximum}
                onClick={() => {
                  setText(undefined);
                  transfer(counts[gain] + 1);
                }}
              />
            </div>
            <div className="grid gap-1">
              <label htmlFor={sliderId} className="sr-only">
                {gain + 1}位と{lose + 1}位の配分
              </label>
              <input
                id={sliderId}
                aria-describedby={buildFieldDescribedBy(descriptionId, errorId, roundingId)}
                type="range"
                className={rangeClass}
                min={minimum}
                max={maximum}
                step="1"
                value={counts[gain]}
                disabled={minimum === maximum}
                aria-valuetext={`${gain + 1}位${counts[gain]}回・${lose + 1}位${counts[lose]}回`}
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId);
                  begin();
                }}
                onPointerUp={() => finish()}
                onPointerCancel={() => finish(true)}
                onBlur={() => finish()}
                onChange={(event) => {
                  setText(undefined);
                  transfer(Number(event.target.value));
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    finish(true);
                    return;
                  }
                  if (!rangeKeys.has(event.key)) return;
                  event.preventDefault();
                  begin();
                  const value =
                    event.key === "Home"
                      ? minimum
                      : event.key === "End"
                        ? maximum
                        : counts[gain] +
                          (["ArrowLeft", "ArrowDown", "PageDown"].includes(event.key) ? -1 : 1);
                  if (value >= minimum && value <= maximum) transfer(value);
                }}
                onKeyUp={(event) => {
                  if (rangeKeys.has(event.key)) finish();
                }}
              />
              <div className={cn(contentText.supporting, "flex justify-between")}>
                <span>{lose + 1}位を増やす</span>
                <span>{gain + 1}位を増やす</span>
              </div>
            </div>
          </div>
        </Field>
      </div>
    </div>
  );
}
