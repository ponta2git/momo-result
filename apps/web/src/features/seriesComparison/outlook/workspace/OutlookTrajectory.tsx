import { useCallback, useId, useState } from "react";
import type { Ref } from "react";

import type { CumulativePair } from "@/features/seriesComparison/outlook/calculation";
import { OutlookChart } from "@/features/seriesComparison/outlook/OutlookChart";
import { parseOutlookHorizon } from "@/features/seriesComparison/outlook/outlookEditing";
import type { OutlookOutcome } from "@/features/seriesComparison/outlook/outlookOutcome";
import { useOutlookEdit } from "@/features/seriesComparison/outlook/OutlookWorkspaceProvider";
import type { OutlookRole } from "@/features/seriesComparison/outlook/outlookWorkspaceState";
import { useOutlookPatterns } from "@/features/seriesComparison/outlook/useOutlookPatterns";
import { useOutlookResultView } from "@/features/seriesComparison/outlook/useOutlookWorkspace";
import type { SeriesAnalysisOutlookSummary } from "@/shared/api/seriesAnalysis";
import {
  MemberSequenceLabel,
  memberSequencePresentation,
} from "@/shared/matches/MemberSequenceLabel";
import { cn } from "@/shared/ui/cn";
import { DataTable } from "@/shared/ui/data/DataTable";
import { InputControl } from "@/shared/ui/forms/Control";
import { contentText, fieldText } from "@/shared/ui/typography";

/** The mean path is the main chart; three examples follow at a smaller size on the same axes. */
export function OutlookTrajectory({
  ref,
  response,
  cumulative,
  names,
  memberIds,
  displayRoles,
  outcome,
  eventHorizon,
}: {
  ref?: Ref<HTMLElement>;
  response: SeriesAnalysisOutlookSummary;
  cumulative: CumulativePair;
  names: readonly [string, string];
  memberIds: readonly [string, string];
  displayRoles: ReadonlyArray<{ memberId: string; role: OutlookRole }>;
  outcome: OutlookOutcome;
  eventHorizon: number | null;
}) {
  const headingId = useId();
  const helpId = useId();
  const view = useOutlookResultView();
  const edit = useOutlookEdit();
  const range = view.chartRange;
  const exampleLabel = useCallback(
    (index: number, tied: boolean) =>
      tied
        ? `展開例${index + 1}`
        : (["有利な例", "中間の例", "不利な例"][index] ?? `展開例${index + 1}`),
    [],
  );
  const model = useOutlookPatterns({
    active: true,
    response,
    cumulative,
    view,
    memberIds,
    marker:
      eventHorizon === null
        ? null
        : { h: eventHorizon, label: `${eventHorizon}戦後に${outcome.eventLabel}` },
    exampleLabel,
  });
  const onHorizonChange = useCallback(
    (next: { horizon: number; horizonText: string }) =>
      edit({
        kind: "horizon",
        target: "performance",
        horizon: next.horizon,
        text: next.horizonText,
      }),
    [edit],
  );
  const [average, ...examplePatterns] = model.patterns;
  const rows = [
    { id: "current", label: "今", basis: "", selected: model.current },
    ...model.patterns.map((pattern, index) => ({
      id: pattern.id,
      label: index === 0 ? "平均どおり" : pattern.label,
      basis: index === 0 ? "" : `${range}戦後 ${model.endpointGaps[index - 1] ?? ""}`,
      selected: pattern.selected,
    })),
  ];
  const examples = model.examples;
  const exampleNote = !examples
    ? "この条件の展開例は作れません。平均どおりの推移だけを表示しています。"
    : examples.constantPerGameDifference
      ? "この内訳では、どの展開例も2人の差は同じ推移になります。"
      : examples.distinctCandidateCount < 3
        ? `${range}戦までの2人の差は${examples.distinctCandidateCount}種類の推移しかなく、同じ推移の例を含みます。`
        : model.hasTiedExamples
          ? `${range}戦後の差が同じ例を含むため、有利・不利の名前は付けていません。`
          : `展開例は${range}戦後の差で並べた、試している平均から作った例です。確率や上下限ではありません。`;

  return (
    <section ref={ref} className="grid min-w-0 gap-4" aria-labelledby={headingId} tabIndex={-1}>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <h2 id={headingId} className={contentText.heading}>
          総合平均の推移
        </h2>
        <HorizonInput
          horizon={view.horizon}
          horizonText={view.horizonText}
          onChange={onHorizonChange}
        />
      </div>
      <div className={cn(contentText.supporting, "flex flex-wrap items-center gap-x-4 gap-y-1")}>
        {displayRoles.map(({ memberId, role }, index) => (
          <span key={memberId} className="inline-flex items-center gap-1.5">
            <svg width="22" height="8" aria-hidden="true">
              <line
                x1="0"
                x2="22"
                y1="4"
                y2="4"
                stroke={memberSequencePresentation(memberId).color}
                strokeWidth="2.5"
                strokeDasharray={index === 1 ? "6 4" : undefined}
              />
            </svg>
            {names[role]}
          </span>
        ))}
        <span id={helpId}>
          {view.gesturing
            ? "展開例は操作を終えると更新します"
            : view.horizon > range
              ? `グラフは${range}戦まで。表は${view.horizon}戦後です`
              : "グラフをタップ・横ドラッグすると見る戦数を変えられます"}
        </span>
      </div>
      {average ? (
        <OutlookChart
          pattern={average}
          caption="平均どおり"
          names={names}
          memberIds={memberIds}
          horizon={view.horizon}
          horizonText={view.horizonText}
          range={range}
          ticks={model.ticks}
          descriptionId={helpId}
          onHorizonChange={onHorizonChange}
          marker={model.averageMarker}
          valueLabels
        />
      ) : null}
      {examplePatterns.length ? (
        <div className="grid min-w-0 grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-3">
          {examplePatterns.map((pattern, index) => (
            <OutlookChart
              key={pattern.id}
              size="compact"
              pattern={pattern}
              caption={
                <>
                  {pattern.label}
                  <span className={cn(contentText.supporting, "ml-2 tabular-nums")}>
                    {range}戦後 {model.endpointGaps[index]}
                  </span>
                </>
              }
              names={names}
              memberIds={memberIds}
              horizon={view.horizon}
              horizonText={view.horizonText}
              range={range}
              ticks={model.ticks}
              descriptionId={helpId}
              onHorizonChange={onHorizonChange}
            />
          ))}
        </div>
      ) : null}
      <DataTable
        caption={{ content: `${view.horizon}戦後の総合平均順位`, visibility: "visible" }}
        density="compact"
        layout="fixed"
        rows={rows}
        getRowKey={(row) => row.id}
        columns={[
          {
            key: "pattern",
            header: "",
            rowHeader: true,
            width: "38%",
            renderCell: (row) => (
              <span className="inline-flex flex-wrap items-baseline gap-x-2">
                {row.label}
                {row.basis ? (
                  <span className={cn(contentText.supporting, "tabular-nums")}>{row.basis}</span>
                ) : null}
              </span>
            ),
          },
          ...displayRoles.map(({ memberId, role }) => ({
            key: memberId,
            header: <MemberSequenceLabel memberId={memberId}>{names[role]}</MemberSequenceLabel>,
            align: "right" as const,
            tabular: true,
            renderCell: (row: (typeof rows)[number]) => `${row.selected.formatted[role]}位`,
          })),
          {
            key: "gap",
            header: `${names[0]}から見た差`,
            align: "right",
            tabular: true,
            renderCell: (row) => row.selected.gapText,
          },
        ]}
      />
      <p className={contentText.supporting}>
        {exampleNote} 差の＋は{names[0]}
        が上。数値は小数第2位に丸め、同率は丸める前の値で判定しています。
      </p>
    </section>
  );
}

function HorizonInput({
  horizon,
  horizonText,
  onChange,
}: {
  horizon: number;
  horizonText: string;
  onChange: (next: { horizon: number; horizonText: string }) => void;
}) {
  const id = useId();
  const [validateBlank, setValidateBlank] = useState(false);
  const blank = horizonText === "";
  const invalid = parseOutlookHorizon(horizonText) === undefined && (!blank || validateBlank);
  return (
    <div className="grid justify-items-end gap-1" data-outlook-preserve-draft>
      <div className="flex items-center gap-2">
        <label htmlFor={id} className={fieldText.label}>
          見る戦数
        </label>
        <div className="w-20">
          <InputControl
            id={id}
            inputMode="numeric"
            textAlign="end"
            invalid={invalid}
            aria-describedby={invalid ? `${id}-error` : undefined}
            value={horizonText}
            onChange={(event) => {
              setValidateBlank(false);
              const next = parseOutlookHorizon(event.target.value);
              onChange({ horizonText: event.target.value, horizon: next ?? horizon });
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
        <span className={contentText.body}>戦後</span>
      </div>
      {invalid ? (
        <p id={`${id}-error`} className={fieldText.error} role="alert">
          1〜1000の整数で入力してください（{horizon}戦後を表示中）
        </p>
      ) : null}
    </div>
  );
}
