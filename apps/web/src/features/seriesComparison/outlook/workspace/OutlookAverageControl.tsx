import { X } from "lucide-react";
import { useId, useRef } from "react";

import {
  distributionMean,
  formatRational,
  meanLimits,
  nextMeanHundredths,
  rational,
  rationalToNumber,
  subtractRationals,
} from "@/features/seriesComparison/outlook/calculation";
import type {
  CumulativePair,
  RankDistribution,
} from "@/features/seriesComparison/outlook/calculation";
import { outlookAverage } from "@/features/seriesComparison/outlook/outlookPresentation";
import type { OutlookRole } from "@/features/seriesComparison/outlook/outlookWorkspaceState";
import { useOutlookPlayerEditor } from "@/features/seriesComparison/outlook/useOutlookPlayerEditor";
import type { SeriesAnalysisOutlookSummary } from "@/shared/api/seriesAnalysis";
import { MemberSequenceLabel } from "@/shared/matches/MemberSequenceLabel";
import { Button } from "@/shared/ui/actions/Button";
import { IconButton } from "@/shared/ui/actions/IconButton";
import { cn } from "@/shared/ui/cn";
import { InputControl } from "@/shared/ui/forms/Control";
import { buildFieldDescribedBy } from "@/shared/ui/forms/Field";
import { contentText, fieldText } from "@/shared/ui/typography";

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
/** Native range thumbs travel inside the track by their radius; ticks follow the same path. */
const THUMB_RADIUS_PX = 8;

function differenceText(recent: RankDistribution, current: RankDistribution, games: number) {
  const difference = subtractRationals(distributionMean(recent), distributionMean(current));
  if (difference.numerator === 0n) return `直近${games}戦と同じ`;
  const absolute = rational(
    difference.numerator < 0n ? -difference.numerator : difference.numerator,
    difference.denominator,
  );
  return `直近${games}戦より ${outlookAverage(absolute)} ${difference.numerator > 0n ? "良い" : "悪い"}`;
}

type Props = {
  response: SeriesAnalysisOutlookSummary;
  cumulative: CumulativePair;
  names: readonly [string, string];
  memberIds: readonly [string, string];
  role: OutlookRole;
  recent: RankDistribution;
};

/**
 * One person's future mean: the value, a slider with the recent mark, and a way back to it. The
 * slot right of the input holds either the pending commit/cancel pair or the way back, so neither
 * moves the input or the slider when it appears.
 */
export function OutlookAverageControl({
  response,
  cumulative,
  names,
  memberIds,
  role,
  recent,
}: Props) {
  const name = names[role];
  const headingId = useId();
  const inputId = useId();
  const sliderId = useId();
  const statusId = `${inputId}-status`;
  const inputRef = useRef<HTMLInputElement>(null);
  const player = useOutlookPlayerEditor({
    response,
    role,
    memberId: memberIds[role],
    cumulative,
    names,
    showComparison: true,
  });
  const { editor, edit } = player;
  const pending = editor.meanDraft !== undefined || editor.error !== undefined;
  const currentMean = distributionMean(editor.distribution);
  const limits = meanLimits(editor.opponent);
  const min = Math.min(limits.minimumHundredths / 100, rationalToNumber(currentMean));
  const max = Math.max(limits.maximumHundredths / 100, rationalToNumber(currentMean));
  const position = (value: number) => (max === min ? 0 : (value - min) / (max - min));
  const recentPosition = position(rationalToNumber(distributionMean(recent)));
  const recentLeft = `calc(${THUMB_RADIUS_PX}px + (100% - ${THUMB_RADIUS_PX * 2}px) * ${recentPosition})`;

  const begin = () => edit({ kind: "begin-gesture", role });
  const finish = (cancel = false) => edit({ kind: "finish-gesture", cancel });
  const commit = () => edit({ kind: "commit-mean", role });
  const cancel = () => {
    edit({ kind: "cancel-mean", role });
    inputRef.current?.focus({ preventScroll: true });
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
            : differenceText(recent, editor.distribution, response.recent.matchCount)}
        </p>
      </div>
      <div className="flex min-w-0 items-center gap-2" data-outlook-preserve-draft>
        <label htmlFor={inputId} className="sr-only">
          {name}のこれからの平均順位
        </label>
        <div className="w-28 shrink-0">
          <InputControl
            ref={inputRef}
            id={inputId}
            inputMode="decimal"
            invalid={Boolean(editor.error)}
            aria-describedby={buildFieldDescribedBy(
              statusId,
              editor.error ? `${inputId}-error` : undefined,
            )}
            value={editor.meanDraft ?? formatRational(currentMean, 4).replace(/(\.\d\d)0+$/u, "$1")}
            onChange={(event) => edit({ kind: "mean-draft", role, text: event.target.value })}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Enter") {
                event.preventDefault();
                commit();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                cancel();
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
              disabled={editor.meanDraft === undefined}
              aria-label={`${name}の平均順位を反映`}
              onClick={commit}
            >
              反映
            </Button>
          </span>
        ) : editor.unchanged ? null : (
          <span className="ml-auto">
            <Button
              size="sm"
              variant="quiet"
              aria-label={`${name}を直近の成績に戻す`}
              onClick={() => {
                player.resetRecent();
                // The action disappears once the value is back; keep focus on this person's input.
                inputRef.current?.focus({ preventScroll: true });
              }}
            >
              直近に戻す
            </Button>
          </span>
        )}
      </div>
      {editor.error ? (
        <p id={`${inputId}-error`} className={fieldText.error} role="alert">
          {editor.error}
        </p>
      ) : null}
      <div className="grid gap-0.5">
        <div className="relative h-4" aria-hidden="true">
          <span
            className={cn(contentText.supporting, "absolute -translate-x-1/2 whitespace-nowrap")}
            style={{ left: recentLeft }}
          >
            直近
          </span>
        </div>
        <div className="relative">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-text-secondary"
            style={{ left: recentLeft }}
          />
          <label htmlFor={sliderId} className="sr-only">
            {name}の平均順位を動かす
          </label>
          <input
            id={sliderId}
            type="range"
            className="relative block min-h-11 w-full cursor-pointer accent-action focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action pointer-fine:min-h-8"
            min={min}
            max={max}
            step="any"
            value={rationalToNumber(currentMean)}
            aria-describedby={statusId}
            aria-valuetext={`${outlookAverage(currentMean)}位。小さいほど良い成績`}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              begin();
            }}
            onPointerUp={() => finish()}
            onPointerCancel={() => finish(true)}
            onBlur={() => finish()}
            onChange={(event) =>
              edit({ kind: "mean", role, hundredths: Math.round(Number(event.target.value) * 100) })
            }
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
                        editor.opponent,
                      );
              if (value !== null) edit({ kind: "mean", role, hundredths: value });
            }}
            onKeyUp={(event) => {
              if (rangeKeys.has(event.key)) finish();
            }}
          />
        </div>
        <div className={cn(contentText.supporting, "flex justify-between tabular-nums")}>
          <span>良い {(limits.minimumHundredths / 100).toFixed(2)}</span>
          <span>{(limits.maximumHundredths / 100).toFixed(2)} 悪い</span>
        </div>
      </div>
    </section>
  );
}
