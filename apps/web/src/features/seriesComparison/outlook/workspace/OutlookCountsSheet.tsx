import { Minus, Plus } from "lucide-react";
import { useId, useMemo, useState } from "react";

import {
  countsPerTwenty,
  distributionFromCounts,
  distributionMean,
  exactWholeCounts,
  formatRational,
  nearestWholeCounts,
  wholeCountCapacities,
} from "@/features/seriesComparison/outlook/calculation";
import type { OutlookEdit } from "@/features/seriesComparison/outlook/outlookEditing";
import { outlookAverage } from "@/features/seriesComparison/outlook/outlookPresentation";
import type { OutlookEditorView } from "@/features/seriesComparison/outlook/outlookProjections";
import type {
  OutlookRankIndex,
  OutlookRole,
} from "@/features/seriesComparison/outlook/outlookWorkspaceState";
import type { useOutlookPlayerEditor } from "@/features/seriesComparison/outlook/useOutlookPlayerEditor";
import { rankColor } from "@/shared/matches/rankPresentation";
import { Button } from "@/shared/ui/actions/Button";
import { IconButton } from "@/shared/ui/actions/IconButton";
import { cn } from "@/shared/ui/cn";
import { Dialog, DialogFooter } from "@/shared/ui/feedback/Dialog";
import { InputControl } from "@/shared/ui/forms/Control";
import { buildFieldDescribedBy } from "@/shared/ui/forms/Field";
import { SelectControl } from "@/shared/ui/forms/SelectControl";
import { contentText, fieldText } from "@/shared/ui/typography";

type DialogModel = ReturnType<typeof useOutlookPlayerEditor>["dialog"];

/**
 * The count editor opens beside the person's control (PC) or from the bottom (narrow screens),
 * leaving the answer and charts readable. Nothing reaches the page until "この回数を使う".
 */
export function OutlookCountsSheet({
  name,
  opponentName,
  appliedMean,
  dialog,
}: {
  name: string;
  opponentName: string;
  appliedMean: string;
  dialog: DialogModel;
}) {
  const proposal = dialog.proposal;
  return (
    <Dialog
      open={dialog.open}
      onOpenChange={dialog.setOpen}
      title={`${name}の順位の回数`}
      description={`20戦あたりの目安です。${opponentName}の回数は変えません。`}
      backdropClassName="bg-backdrop/10"
      popupClassName="max-lg:items-end lg:mx-0 lg:ml-[max(1rem,calc((100vw-90rem)/2+1rem))] lg:max-w-[28rem]"
      trigger={
        <Button size="sm" variant="quiet" aria-label={`${name}を順位の回数で調整`}>
          回数で調整
        </Button>
      }
    >
      {proposal ? (
        <div className="grid min-w-0 gap-5" data-outlook-preserve-draft>
          <OutlookCountsEditor
            key={proposal.editorVersion}
            view={proposal.editor}
            role={proposal.role}
            name={proposal.name}
            edit={dialog.edit}
          />
          <div className="grid gap-1 rounded-sm bg-surface-subtle px-3 py-2" aria-live="polite">
            <p className={contentText.supporting}>この回数を続けると</p>
            <p className={cn(contentText.compactPrimary, "tabular-nums")}>
              平均 {proposal.average}位（今は {appliedMean}位）
            </p>
            <p className={contentText.body}>{proposal.outcome.headline}</p>
          </div>
          {proposal.stale ? (
            <p className={contentText.body} role="status">
              実績または比較する人が変わりました。閉じて、今の条件から設定し直してください。
            </p>
          ) : null}
          <div className="-mt-3 -ml-2">
            <Button variant="quiet" size="sm" disabled={!proposal.canUndo} onClick={dialog.undo}>
              回数の変更を戻す
            </Button>
          </div>
          <DialogFooter>
            <Button variant="quiet" onClick={() => dialog.setOpen(false)}>
              キャンセル
            </Button>
            <Button
              variant="primary"
              aria-disabled={!proposal.canApply || undefined}
              onClick={dialog.apply}
            >
              この回数を使う
            </Button>
          </DialogFooter>
        </div>
      ) : null}
    </Dialog>
  );
}

const rankOptions = (disabled: number) =>
  [0, 1, 2, 3].map((value) => ({
    value: String(value),
    label: `${value + 1}位`,
    disabled: value === disabled,
  }));

/** "Move one game from rank A to rank B", with the 20 games shown as cells. */
function OutlookCountsEditor({
  view,
  role,
  name,
  edit,
}: {
  view: OutlookEditorView;
  role: OutlookRole;
  name: string;
  edit: (intent: OutlookEdit) => void;
}) {
  const [gain, lose] = view.transfer;
  const { exact, counts } = useMemo(() => {
    const whole = exactWholeCounts(view.distribution);
    return { exact: whole, counts: whole ?? nearestWholeCounts(view.distribution, view.opponent) };
  }, [view.distribution, view.opponent]);
  const [opening] = useState(() => ({ exact, counts, mean: distributionMean(view.distribution) }));
  const [text, setText] = useState<string>();
  const countId = useId();
  const descriptionId = `${countId}-description`;
  const errorId = view.error ? `${countId}-error` : undefined;
  const roundingId = opening.exact || !opening.counts ? undefined : `${countId}-rounding`;
  if (!counts)
    return (
      <p className={contentText.body}>
        相手の成績と両立する20回の配分がありません。平均順位で調整してください。
      </p>
    );
  const capacity = wholeCountCapacities(view.opponent);
  const total = counts[gain] + counts[lose];
  const minimum = Math.max(0, total - capacity[lose]);
  const maximum = Math.min(capacity[gain], total);
  const begin = () => edit({ kind: "begin-gesture", role });
  const finish = (cancel = false) => edit({ kind: "finish-gesture", cancel });
  const transfer = (value: number) => edit({ kind: "transfer", role, value });
  const shown = exact ?? counts;
  const deltas = opening.exact
    ? shown.map((value, index) => value - (opening.exact?.[index] ?? value))
    : null;
  const fractional = exact ? null : countsPerTwenty(view.distribution);

  return (
    <div className="grid min-w-0 gap-4">
      <div className="grid gap-2">
        <div className="grid grid-cols-[repeat(20,minmax(0,1fr))] gap-0.5" aria-hidden="true">
          {shown.flatMap((count, rank) =>
            Array.from({ length: count }, (_, index) => (
              <span
                key={`${rank}-${index}`}
                className="h-5 rounded-xs"
                style={{ backgroundColor: rankColor(rank + 1) }}
              />
            )),
          )}
        </div>
        <dl className="grid grid-cols-4 text-center" aria-label={`${name}の20戦あたりの回数`}>
          {shown.map((count, rank) => (
            <div key={rank} className="grid gap-0.5">
              <dt className={contentText.supporting}>{rank + 1}位</dt>
              <dd className={cn(contentText.compactPrimary, "tabular-nums")}>
                {fractional ? formatRational(fractional[rank] ?? fractional[0], 2) : count}回
                {deltas && deltas[rank] ? (
                  <span className={cn(contentText.supporting, "ml-1")}>
                    {(deltas[rank] ?? 0) > 0
                      ? `+${deltas[rank]}`
                      : `−${Math.abs(deltas[rank] ?? 0)}`}
                  </span>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
        {roundingId && opening.counts ? (
          <p id={roundingId} className={contentText.supporting}>
            1回単位で動かすため、{" "}
            {opening.counts.map((value, rank) => `${rank + 1}位${value}`).join("・")}
            回から始めます（平均 {outlookAverage(opening.mean)} →{" "}
            {outlookAverage(distributionMean(distributionFromCounts(opening.counts)))}位）。
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="移す順位">
        <div className="w-24">
          <SelectControl
            aria-label="減らす順位"
            value={String(lose)}
            options={rankOptions(gain)}
            onValueChange={(value) => {
              setText(undefined);
              edit({
                kind: "transfer-rank",
                role,
                side: "lose",
                rank: Number(value) as OutlookRankIndex,
              });
            }}
          />
        </div>
        <span className={contentText.body}>から</span>
        <div className="w-24">
          <SelectControl
            aria-label="増やす順位"
            value={String(gain)}
            options={rankOptions(lose)}
            onValueChange={(value) => {
              setText(undefined);
              edit({
                kind: "transfer-rank",
                role,
                side: "gain",
                rank: Number(value) as OutlookRankIndex,
              });
            }}
          />
        </div>
        <span className={contentText.body}>へ移す</span>
      </div>
      <div className="grid gap-1">
        <div className="flex items-center gap-2">
          <label htmlFor={countId} className={fieldText.label}>
            {gain + 1}位の回数
          </label>
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
          <div className="w-16">
            <InputControl
              id={countId}
              inputMode="numeric"
              textAlign="center"
              invalid={Boolean(view.error)}
              aria-describedby={buildFieldDescribedBy(descriptionId, errorId, roundingId)}
              value={text ?? String(counts[gain])}
              onChange={(event) => {
                setText(event.target.value);
                edit({ kind: "count-input", role, text: event.target.value });
              }}
              onBlur={() => {
                if (view.error) return;
                setText(undefined);
                edit({ kind: "finish-gesture", cancel: false, clearErrorFor: role });
              }}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === "Enter" || event.key === "Escape") {
                  event.preventDefault();
                  if (event.key === "Enter" && view.error) return;
                  setText(undefined);
                  edit({
                    kind: "finish-gesture",
                    cancel: event.key === "Escape",
                    clearErrorFor: role,
                  });
                }
              }}
            />
          </div>
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
        <p id={descriptionId} className={contentText.supporting}>
          {minimum === maximum
            ? `この組み合わせでは ${minimum}回から動かせません。`
            : `相手と両立する範囲は ${minimum}〜${maximum}回です。`}
        </p>
        {view.error ? (
          <p id={errorId} className={fieldText.error} role="alert">
            {view.error}
          </p>
        ) : null}
        <input
          type="range"
          aria-label={`${gain + 1}位と${lose + 1}位の配分`}
          aria-valuetext={`${gain + 1}位${counts[gain]}回・${lose + 1}位${counts[lose]}回`}
          className="block min-h-11 w-full cursor-pointer accent-action focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action disabled:cursor-not-allowed disabled:opacity-50 pointer-fine:min-h-8"
          min={minimum}
          max={maximum}
          step="1"
          value={counts[gain]}
          disabled={minimum === maximum}
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
            if (
              !["ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp", "Home", "End"].includes(
                event.key,
              )
            )
              return;
            event.preventDefault();
            begin();
            const value =
              event.key === "Home"
                ? minimum
                : event.key === "End"
                  ? maximum
                  : counts[gain] + (["ArrowLeft", "ArrowDown"].includes(event.key) ? -1 : 1);
            if (value >= minimum && value <= maximum) transfer(value);
          }}
          onKeyUp={(event) => {
            if (
              ["ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
            )
              finish();
          }}
        />
      </div>
    </div>
  );
}
