import {
  countsFromMean,
  distributionMean,
  formatRational,
  meanInput,
} from "@/features/seriesComparison/outlook/calculation";
import {
  applyOutlookExample,
  applyOutlookGoal,
  parseOutlookHorizon,
} from "@/features/seriesComparison/outlook/outlookProposals";
import type { OutlookGoalExpectation } from "@/features/seriesComparison/outlook/outlookProposals";
import type { HistoricalOutlookExample } from "@/features/seriesComparison/outlook/outlookReferenceTypes";
import {
  applyOutlookDistribution,
  beginOutlookGesture,
  finishOutlookGesture,
  otherRole,
  updateOutlookEntry,
} from "@/features/seriesComparison/outlook/outlookWorkspaceState";
import type {
  OutlookEntry,
  OutlookRole,
  OutlookWorkspaceState,
} from "@/features/seriesComparison/outlook/outlookWorkspaceState";

/** The graph range that contains the goal, up to 200 games; later goals are read in the table. */
export function outlookChartRange(goalHorizon: number): 50 | 100 | 200 {
  return goalHorizon <= 50 ? 50 : goalHorizon <= 100 ? 100 : 200;
}

export type OutlookEdit =
  | { kind: "mean-draft"; role: OutlookRole; text: string }
  | { kind: "cancel-mean" | "commit-mean" | "begin-gesture"; role: OutlookRole }
  | { kind: "mean"; role: OutlookRole; hundredths: number }
  | { kind: "finish-gesture"; cancel: boolean }
  | { kind: "goal-horizon"; text: string }
  | { kind: "dismiss-notice" }
  | {
      kind: "restore-recent";
      role: OutlookRole;
      recent: Pick<OutlookEntry, "distribution" | "source">;
    }
  | { kind: "apply-goal"; expected: OutlookGoalExpectation; maximumHundredths: number }
  | {
      kind: "apply-example";
      expected: OutlookGoalExpectation;
      example: HistoricalOutlookExample;
    };

/** A mean step during a gesture starts from the gesture's exact origin, never a rounded value. */
function setMean(current: OutlookWorkspaceState, role: OutlookRole, hundredths: number) {
  const origin = current.gesture?.before[role] ?? current.entries[role];
  const originMean = distributionMean(origin.distribution);
  if (originMean.numerator * 100n === BigInt(hundredths) * originMean.denominator)
    return applyOutlookDistribution(current, role, origin.distribution, origin.source);
  const distribution = countsFromMean(
    hundredths,
    current.entries[otherRole(role)].distribution,
    origin.distribution,
  );
  return distribution
    ? applyOutlookDistribution(current, role, distribution, { kind: "average" })
    : updateOutlookEntry(current, role, {
        error: "この平均は相手の成績と両立しません。設定できる範囲で調整してください。",
      });
}

function commitMean(current: OutlookWorkspaceState, role: OutlookRole) {
  const edited = current.entries[role];
  if (edited.meanDraft === undefined) return current;
  const mean = distributionMean(edited.distribution);
  const input = meanInput(edited.meanDraft, mean);
  if (edited.meanDraft === formatRational(mean, 4) || input.kind === "unchanged")
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
        error: "この平均は相手の成績と両立しません。相手の指定は変えず、入力を見直してください。",
      });
}

/** Every editing intent is resolved against the latest complete pair before one commit. */
export function editOutlook(
  current: OutlookWorkspaceState,
  edit: OutlookEdit,
): OutlookWorkspaceState {
  switch (edit.kind) {
    case "mean-draft":
      return updateOutlookEntry(current, edit.role, { meanDraft: edit.text, error: undefined });
    case "cancel-mean":
      return updateOutlookEntry(current, edit.role, { meanDraft: undefined, error: undefined });
    case "commit-mean":
      return commitMean(current, edit.role);
    case "mean":
      return setMean(current, edit.role, edit.hundredths);
    case "begin-gesture":
      return beginOutlookGesture(current, edit.role);
    case "finish-gesture":
      return finishOutlookGesture(current, edit.cancel);
    case "goal-horizon":
      return {
        ...current,
        goalHorizonText: edit.text,
        goalHorizon: parseOutlookHorizon(edit.text) ?? current.goalHorizon,
        rejection: undefined,
      };
    case "dismiss-notice":
      return { ...current, notice: undefined };
    case "restore-recent":
      return applyOutlookDistribution(
        finishOutlookGesture(current),
        edit.role,
        edit.recent.distribution,
        edit.recent.source,
      );
    case "apply-goal":
      return applyOutlookGoal(current, edit.expected, edit.maximumHundredths);
    case "apply-example":
      return applyOutlookExample(current, edit.expected, edit.example);
  }
}
