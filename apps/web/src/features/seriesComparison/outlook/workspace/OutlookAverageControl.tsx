import { X } from "lucide-react";
import { useId, useRef } from "react";

import {
  compareRationals,
  distributionMean,
  distributionsEqual,
  formatRational,
  meanLimits,
  nextMeanHundredths,
  rational,
  rationalToNumber,
  subtractRationals,
} from "@/features/seriesComparison/outlook/calculation";
import type { RankDistribution, Rational } from "@/features/seriesComparison/outlook/calculation";
import {
  outlookAverage,
  outlookSourceLabel,
} from "@/features/seriesComparison/outlook/outlookPresentation";
import type { OutlookRole } from "@/features/seriesComparison/outlook/outlookWorkspaceState";
import { useOutlookPlayerEditor } from "@/features/seriesComparison/outlook/useOutlookPlayerEditor";
import type { SeriesAnalysisOutlookSummary } from "@/shared/api/seriesAnalysis";
import { isImeComposing } from "@/shared/lib/ime";
import { MemberSequenceLabel } from "@/shared/matches/MemberSequenceLabel";
import { Button } from "@/shared/ui/actions/Button";
import { IconButton } from "@/shared/ui/actions/IconButton";
import { cn } from "@/shared/ui/cn";
import { InputControl } from "@/shared/ui/forms/Control";
import { buildFieldDescribedBy } from "@/shared/ui/forms/Field";
import { Slider } from "@/shared/ui/forms/Slider";
import { contentText, fieldText } from "@/shared/ui/typography";

function differenceText(recent: RankDistribution, current: RankDistribution, games: number) {
  const difference = subtractRationals(distributionMean(recent), distributionMean(current));
  if (difference.numerator === 0n) return `直近${games}戦と同じ`;
  const absolute = rational(
    difference.numerator < 0n ? -difference.numerator : difference.numerator,
    difference.denominator,
  );
  return `直近${games}戦より ${outlookAverage(absolute)} ${difference.numerator > 0n ? "良い" : "悪い"}`;
}

/** The legal 0.01 value `steps` steps away, or null when none lies in that direction. */
function stepped(mean: Rational, direction: -1 | 1, steps: number, opponent: RankDistribution) {
  let value = mean;
  let result: number | null = null;
  for (let step = 0; step < steps; step++) {
    const next = nextMeanHundredths(value, direction, opponent);
    if (next === null) break;
    result = next;
    value = rational(BigInt(next), 100n);
  }
  return result;
}

/**
 * One person's future mean: the value, a slider with the recent mark, and a way back to it. The
 * slot right of the input holds either the pending commit and cancel pair or the way back, so
 * neither moves the input or the slider when it appears.
 */
export function OutlookAverageControl({
  response,
  names,
  memberIds,
  role,
  recent,
}: {
  response: SeriesAnalysisOutlookSummary;
  names: readonly [string, string];
  memberIds: readonly [string, string];
  role: OutlookRole;
  recent: RankDistribution;
}) {
  const name = names[role];
  const headingId = useId();
  const inputId = useId();
  const statusId = `${inputId}-status`;
  const sourceId = `${inputId}-source`;
  const inputRef = useRef<HTMLInputElement>(null);
  const player = useOutlookPlayerEditor({ response, role, memberId: memberIds[role] });
  const { view } = player;
  const pending = view.meanDraft !== undefined || view.error !== undefined;
  const currentMean = distributionMean(view.distribution);
  const unchanged =
    distributionsEqual(view.distribution, recent) &&
    view.source.kind === "recent" &&
    view.source.artifactId === view.artifactId &&
    view.meanDraft === undefined;
  const limits = meanLimits(view.opponent);
  const legalMin = rational(BigInt(limits.minimumHundredths), 100n);
  const legalMax = rational(BigInt(limits.maximumHundredths), 100n);
  const outside =
    compareRationals(currentMean, legalMin) < 0 || compareRationals(currentMean, legalMax) > 0;
  const current = rationalToNumber(currentMean);
  const source =
    outlookSourceLabel(view.source, view.artifactId) ??
    (outside
      ? `この平均は、${names[role === 0 ? 1 : 0]}の今の指定と合わせて設定できる${(limits.minimumHundredths / 100).toFixed(2)}〜${(limits.maximumHundredths / 100).toFixed(2)}の外にあります`
      : null);
  const focusInput = () => inputRef.current?.focus({ preventScroll: true });
  const commit = () => {
    player.commit();
    focusInput();
  };
  const cancel = () => {
    player.cancel();
    focusInput();
  };

  return (
    <section className="grid min-w-0 gap-2" aria-labelledby={headingId}>
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 id={headingId} className={cn(contentText.heading, "flex items-center")}>
          <MemberSequenceLabel memberId={memberIds[role]}>{name}</MemberSequenceLabel>
        </h3>
        <p id={statusId} className={cn(contentText.supporting, "tabular-nums")}>
          {pending
            ? `未反映・結果は ${outlookAverage(currentMean)}位 のまま`
            : differenceText(recent, view.distribution, response.recent.matchCount)}
        </p>
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <label htmlFor={inputId} className="sr-only">
          {name}のこれからの平均順位
        </label>
        <div className="w-28 shrink-0">
          <InputControl
            ref={inputRef}
            id={inputId}
            inputMode="decimal"
            invalid={Boolean(view.error)}
            aria-describedby={buildFieldDescribedBy(
              statusId,
              view.error ? `${inputId}-error` : undefined,
            )}
            value={view.meanDraft ?? formatRational(currentMean, 4).replace(/(\.\d\d)0+$/u, "$1")}
            onChange={(event) => player.draft(event.target.value)}
            onKeyDown={(event) => {
              if (isImeComposing(event)) return;
              if (event.key === "Enter") {
                event.preventDefault();
                player.commit();
              }
              if (event.key === "Escape" && pending) {
                event.preventDefault();
                player.cancel();
              }
            }}
          />
        </div>
        <span className={contentText.body}>位</span>
        {pending ? (
          <span className="ml-auto flex items-center gap-1">
            <IconButton
              variant="quiet"
              size="sm"
              icon={<X />}
              aria-label={`${name}の入力を取り消す`}
              onClick={cancel}
            />
            <Button
              size="sm"
              variant="secondary"
              disabled={view.meanDraft === undefined}
              aria-label={`${name}の平均順位を反映`}
              onClick={commit}
            >
              反映
            </Button>
          </span>
        ) : unchanged ? null : (
          <span className="ml-auto">
            <Button
              size="sm"
              variant="quiet"
              aria-label={`${name}を直近の成績に戻す`}
              onClick={() => {
                player.restoreRecent();
                // The action disappears once the value is back; keep focus on this input.
                focusInput();
              }}
            >
              直近に戻す
            </Button>
          </span>
        )}
      </div>
      {view.error ? (
        <p id={`${inputId}-error`} className={fieldText.error} role="alert">
          {view.error}
        </p>
      ) : null}
      <Slider
        aria-label={`${name}の平均順位を動かす`}
        aria-describedby={buildFieldDescribedBy(statusId, source ? sourceId : undefined)}
        value={current}
        min={Math.min(limits.minimumHundredths / 100, current)}
        max={Math.max(limits.maximumHundredths / 100, current)}
        valueText={`${outlookAverage(currentMean)}位。小さいほど良い成績`}
        marks={[{ value: rationalToNumber(distributionMean(recent)), label: "直近" }]}
        startLabel={`良い ${(limits.minimumHundredths / 100).toFixed(2)}`}
        endLabel={`${(limits.maximumHundredths / 100).toFixed(2)} 悪い`}
        onGestureStart={player.begin}
        onGestureEnd={({ canceled }) => player.finish(canceled)}
        onStep={(direction, large) => {
          const next = stepped(currentMean, direction, large ? 10 : 1, view.opponent);
          if (next !== null) player.setMean(next);
        }}
        onBoundary={(edge) =>
          player.setMean(edge === "min" ? limits.minimumHundredths : limits.maximumHundredths)
        }
        onDrag={(value) =>
          player.setMean(
            Math.min(
              limits.maximumHundredths,
              Math.max(limits.minimumHundredths, Math.round(value * 100)),
            ),
          )
        }
      />
      <p id={sourceId} className={cn(contentText.supporting, "min-h-4")}>
        {source}
      </p>
    </section>
  );
}
