import { useId } from "react";

import {
  countCapacities,
  countsFromMean,
  distributionCountUnits,
  distributionFromCountUnits,
  distributionMean,
  formatRational,
  incompatibleRanks,
  meanInput,
  meanLimits,
  nearestCountUnits,
  nextMeanHundredths,
  parseDecimal,
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
import { SelectField } from "@/shared/ui/forms/SelectField";
import { TextField } from "@/shared/ui/forms/TextField";
import { contentText, fieldText } from "@/shared/ui/typography";

const rangeClass =
  "min-h-11 w-full cursor-pointer accent-[var(--color-action)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-action)] disabled:cursor-not-allowed disabled:opacity-50";
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
  name: string;
  change: (update: (session: OutlookSession) => OutlookSession) => void;
};

export function OutlookEditor({ session, name, change }: Props) {
  const role = session.editor;
  const entry = session.entries[role];
  const opponent = session.entries[otherRole(role)].distribution;
  const currentMean = distributionMean(entry.distribution);
  const limits = meanLimits(opponent);
  const sliderId = useId();
  const rangeErrorId = `${sliderId}-error`;
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
  const commitMean = () =>
    change((current) => {
      const edited = current.entries[role];
      if (edited.meanDraft === undefined || edited.countDraft) return current;
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
  const exactUnits = distributionCountUnits(entry.distribution);
  const proposal = exactUnits ?? nearestCountUnits(entry.distribution, opponent);
  const texts =
    entry.countDraft ??
    (proposal?.map((value) => (value / 100).toFixed(2)) as
      | [string, string, string, string]
      | undefined);
  const parsed = texts?.map((text) => {
    const value = parseDecimal(text);
    if (
      !value ||
      value.numerator < 0n ||
      value.numerator > 20n * value.denominator ||
      (value.numerator * 100n) % value.denominator !== 0n
    )
      return null;
    return Number((value.numerator * 100n) / value.denominator);
  });
  const sum = parsed?.every((value) => value !== null)
    ? parsed.reduce((value, next) => value + (next ?? 0), 0)
    : null;
  const proposedDistribution = sum === 2000 ? distributionFromCountUnits(parsed as number[]) : null;
  const conflict = proposedDistribution ? incompatibleRanks(proposedDistribution, opponent) : [];
  const countsError =
    sum === null
      ? "各順位を0〜20回、0.01回刻みで入力してください。"
      : sum !== 2000
        ? `合計${(sum / 100).toFixed(2)}回です。${sum < 2000 ? "あと" : "超過は"}${(Math.abs(2000 - sum) / 100).toFixed(2)}回です。`
        : conflict.length
          ? `${conflict.join("・")}位は相手との合計が20回を超えます。`
          : undefined;
  const [from, to] = session.transfer;
  const capacity = countCapacities(opponent);
  const total = exactUnits ? exactUnits[from] + exactUnits[to] : 0;
  const transferMin = Math.max(0, total - capacity[to]);
  const transferMax = Math.min(capacity[from], total);
  const transfer = (value: number) =>
    change((current) => {
      const units = distributionCountUnits(current.entries[role].distribution);
      if (!units || current.entries[role].countDraft) return current;
      const next = [...units];
      next[to] = units[from] + units[to] - value;
      next[from] = value;
      return applyOutlookDistribution(current, role, distributionFromCountUnits(next), {
        kind: "counts",
      });
    });
  return (
    <div className="grid min-w-0 gap-3">
      {session.method === "mean" ? (
        <>
          <TextField
            label={`${name}のこれからの平均順位`}
            inputMode="decimal"
            value={entry.meanDraft ?? formatRational(currentMean, 4)}
            disabled={Boolean(entry.countDraft)}
            description={`小さいほど良い成績です。設定できる平均は${(limits.minimumHundredths / 100).toFixed(2)}〜${(limits.maximumHundredths / 100).toFixed(2)}位。`}
            error={entry.error}
            onChange={(event) =>
              change((current) =>
                updateOutlookEntry(current, role, {
                  meanDraft: event.target.value,
                  error: undefined,
                }),
              )
            }
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitMean();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                change((current) =>
                  updateOutlookEntry(current, role, { meanDraft: undefined, error: undefined }),
                );
              }
            }}
            onBlur={(event) => {
              const target = event.relatedTarget;
              const input = event.currentTarget;
              if (
                target instanceof Element &&
                !target.closest("a,[role=tab],[data-outlook-preserve-draft]")
              )
                commitMean();
              if (target === null) {
                // A plain chart click has no focus target. Let navigation unmount first,
                // so leaving the view or browser keeps unfinished text instead.
                queueMicrotask(() => {
                  if (input.isConnected && document.hasFocus()) commitMean();
                });
              }
            }}
          />
          <div>
            <label htmlFor={sliderId} className={fieldText.label}>
              {name}の平均順位を動かす
            </label>
            <input
              id={sliderId}
              aria-describedby={entry.error ? rangeErrorId : undefined}
              type="range"
              className={rangeClass}
              min={Math.min(limits.minimumHundredths / 100, rationalToNumber(currentMean))}
              max={Math.max(limits.maximumHundredths / 100, rationalToNumber(currentMean))}
              step="any"
              value={rationalToNumber(currentMean)}
              disabled={Boolean(entry.countDraft)}
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
            {entry.error ? (
              <p className={fieldText.error} id={rangeErrorId}>
                {entry.error}
              </p>
            ) : null}
          </div>
        </>
      ) : (
        <>
          <p className={contentText.supporting}>
            20戦あたりの目安です。手入力では、ほかの順位の回数は変わりません。
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[0, 1, 2, 3].map((index) => (
              <TextField
                key={index}
                label={`${name}の${index + 1}位の回数`}
                inputMode="decimal"
                value={texts?.[index] ?? ""}
                onChange={(event) => {
                  const draft = [...(texts ?? ["", "", "", ""])] as [
                    string,
                    string,
                    string,
                    string,
                  ];
                  draft[index] = event.target.value;
                  change((current) =>
                    updateOutlookEntry(current, role, { countDraft: draft, error: undefined }),
                  );
                }}
              />
            ))}
          </div>
          {!exactUnits ? (
            <p className={contentText.supporting}>
              入力しやすい回数に丸めています。反映すると平均も変わる場合があります。現在
              {outlookAverage(currentMean)}位
              {proposedDistribution
                ? ` → 反映後${outlookAverage(distributionMean(proposedDistribution))}位`
                : ""}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              size="sm"
              variant="secondary"
              disabled={Boolean(countsError) || !proposedDistribution}
              onClick={() => {
                if (proposedDistribution)
                  change((current) =>
                    applyOutlookDistribution(current, role, proposedDistribution, {
                      kind: "counts",
                    }),
                  );
              }}
            >
              回数を反映
            </Button>
            <span className={contentText.body}>
              合計 {sum === null ? "—" : (sum / 100).toFixed(2)} / 20回
            </span>
          </div>
          {countsError ? (
            <p className={fieldText.error} role="status">
              {countsError}
            </p>
          ) : null}
          <div className="grid grid-cols-2 gap-3" data-outlook-preserve-draft>
            <SelectField
              label="回数を動かす順位"
              value={String(from)}
              options={[0, 1, 2, 3].map((index) => ({
                label: `${index + 1}位`,
                value: String(index),
                disabled: index === to,
              }))}
              onValueChange={(value) =>
                change((current) => ({
                  ...current,
                  transfer: [Number(value) as OutlookRankIndex, current.transfer[1]],
                }))
              }
            />
            <SelectField
              label="入れ替える順位"
              value={String(to)}
              options={[0, 1, 2, 3].map((index) => ({
                label: `${index + 1}位`,
                value: String(index),
                disabled: index === from,
              }))}
              onValueChange={(value) =>
                change((current) => ({
                  ...current,
                  transfer: [current.transfer[0], Number(value) as OutlookRankIndex],
                }))
              }
            />
          </div>
          <div>
            <label htmlFor={sliderId} className={fieldText.label}>
              {from + 1}位と{to + 1}位の合計を保って動かす
            </label>
            <input
              id={sliderId}
              type="range"
              className={rangeClass}
              min={transferMin}
              max={Math.max(transferMin, transferMax)}
              step={1}
              value={exactUnits?.[from] ?? 0}
              disabled={!exactUnits || Boolean(entry.countDraft) || transferMin === transferMax}
              aria-valuetext={`${from + 1}位 ${(exactUnits?.[from] ?? 0) / 100}回、${to + 1}位 ${(exactUnits?.[to] ?? 0) / 100}回`}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                begin();
              }}
              onPointerUp={() => finish()}
              onPointerCancel={() => finish(true)}
              onBlur={() => finish()}
              onChange={(event) => transfer(Number(event.target.value))}
              onKeyDown={(event) => {
                if (rangeKeys.has(event.key)) begin();
                if (event.key === "Escape") {
                  event.preventDefault();
                  finish(true);
                }
              }}
              onKeyUp={(event) => {
                if (rangeKeys.has(event.key)) finish();
              }}
            />
            {!exactUnits ? (
              <p className={contentText.supporting}>
                配分を動かすには、先に入力案の「回数を反映」を選んでください。
              </p>
            ) : null}
          </div>
          {entry.error ? (
            <p className={fieldText.error} role="status">
              {entry.error}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
