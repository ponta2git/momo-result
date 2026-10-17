import {
  countsFromMean,
  distributionFromCounts,
  distributionMean,
  distributionsEqual,
  exactWholeCounts,
  formatRational,
  meanInput,
  nearestWholeCounts,
  wholeCountCapacities,
} from "@/features/seriesComparison/model/outlook";
import {
  applyOutlookDistribution,
  beginOutlookGesture,
  finishOutlookGesture,
  otherRole,
  pinOutlook,
  undoOutlook,
  updateOutlookEntry,
} from "@/features/seriesComparison/outlook/outlookSession";
import type {
  OutlookRankIndex,
  OutlookRole,
  OutlookSession,
} from "@/features/seriesComparison/outlook/outlookSession";

export function parseOutlookHorizon(text: string) {
  const value = Number(text);
  return /^\d+$/u.test(text) && value >= 1 && value <= 1000 ? value : undefined;
}

export function outlookChartRange(horizon: number): 50 | 100 | 200 {
  return horizon <= 50 ? 50 : horizon <= 100 ? 100 : 200;
}

export type OutlookEdit =
  | { kind: "mean-draft"; role: OutlookRole; text: string }
  | { kind: "cancel-mean" | "commit-mean" | "begin-gesture"; role: OutlookRole }
  | { kind: "mean"; role: OutlookRole; hundredths: number }
  | { kind: "finish-gesture"; cancel: boolean; clearErrorFor?: OutlookRole }
  | { kind: "transfer"; role: OutlookRole; value: number }
  | { kind: "transfer-rank"; role: OutlookRole; side: "gain" | "lose"; rank: OutlookRankIndex }
  | { kind: "count-input"; role: OutlookRole; text: string }
  | { kind: "undo" | "pin" | "unpin" | "use-performance" }
  | { kind: "task"; task: "performance" | "goal" }
  | { kind: "horizon"; target: "performance" | "goal"; horizon: number; text: string }
  | { kind: "show-horizon"; horizon: number }
  | { kind: "chart-range"; range: 50 | 100 | 200 }
  | { kind: "examples-open"; role: OutlookRole; open: boolean };

function setMean(current: OutlookSession, role: OutlookRole, hundredths: number) {
  const start = current.gesture?.before[role].distribution ?? current.entries[role].distribution;
  const startMean = distributionMean(start);
  if (startMean.numerator * 100n === BigInt(hundredths) * startMean.denominator)
    return applyOutlookDistribution(
      current,
      role,
      start,
      current.gesture?.before[role].source ?? current.entries[role].source,
    );
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
}

function commitMean(current: OutlookSession, role: OutlookRole) {
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

function transferCount(current: OutlookSession, role: OutlookRole, value: number) {
  const [gain, lose] = current.transfer;
  const origin = current.gesture?.before[role].distribution ?? current.entries[role].distribution;
  const other = current.entries[otherRole(role)].distribution;
  const base = exactWholeCounts(origin) ?? nearestWholeCounts(origin, other);
  if (!base || !Number.isInteger(value)) return current;
  const limits = wholeCountCapacities(other);
  const total = base[gain] + base[lose];
  const next = [...base];
  next[gain] = value;
  next[lose] = total - value;
  if (next[gain] < 0 || next[lose] < 0 || next[gain] > limits[gain] || next[lose] > limits[lose])
    return updateOutlookEntry(current, role, {
      error: `${gain + 1}位は${Math.max(0, total - limits[lose])}〜${Math.min(limits[gain], total)}回で指定してください。`,
    });
  if (value === base[gain])
    return distributionsEqual(current.entries[role].distribution, origin) || !current.gesture
      ? updateOutlookEntry(current, role, { error: undefined })
      : applyOutlookDistribution(current, role, origin, current.gesture.before[role].source);
  return applyOutlookDistribution(current, role, distributionFromCounts(next), { kind: "counts" });
}

/** Every editing intent is resolved against the latest complete pair before one commit. */
export function editOutlook(current: OutlookSession, edit: OutlookEdit): OutlookSession {
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
    case "finish-gesture": {
      const next = finishOutlookGesture(current, edit.cancel);
      return edit.clearErrorFor === undefined
        ? next
        : updateOutlookEntry(next, edit.clearErrorFor, { error: undefined });
    }
    case "transfer":
      return transferCount(current, edit.role, edit.value);
    case "transfer-rank": {
      const [gain, lose] = current.transfer;
      return {
        ...updateOutlookEntry(finishOutlookGesture(current), edit.role, { error: undefined }),
        transfer: edit.side === "lose" ? [gain, edit.rank] : [edit.rank, lose],
      };
    }
    case "count-input": {
      const [gain, lose] = current.transfer;
      const entry = current.entries[edit.role];
      const other = current.entries[otherRole(edit.role)].distribution;
      const counts =
        exactWholeCounts(entry.distribution) ?? nearestWholeCounts(entry.distribution, other);
      if (!counts) return current;
      const capacity = wholeCountCapacities(other);
      const total = counts[gain] + counts[lose];
      const minimum = Math.max(0, total - capacity[lose]);
      const maximum = Math.min(capacity[gain], total);
      if (/^\d+$/u.test(edit.text) && Number(edit.text) >= minimum && Number(edit.text) <= maximum)
        return transferCount(beginOutlookGesture(current, edit.role), edit.role, Number(edit.text));
      return updateOutlookEntry(current, edit.role, {
        error: `${minimum}〜${maximum}の整数を入力してください。`,
      });
    }
    case "undo":
      return undoOutlook(current);
    case "pin":
      return pinOutlook(current);
    case "unpin":
      return { ...current, pinned: undefined };
    case "task":
      return { ...current, task: edit.task };
    case "horizon":
      return edit.target === "goal"
        ? { ...current, goalHorizon: edit.horizon, goalHorizonText: edit.text }
        : { ...current, horizon: edit.horizon, horizonText: edit.text };
    case "show-horizon":
      return {
        ...current,
        horizon: edit.horizon,
        horizonText: String(edit.horizon),
        chartRange: Math.max(current.chartRange, outlookChartRange(edit.horizon)) as 50 | 100 | 200,
      };
    case "use-performance":
      return {
        ...current,
        task: "performance",
        horizon: current.goalHorizon,
        horizonText: String(current.goalHorizon),
        chartRange: Math.max(current.chartRange, outlookChartRange(current.goalHorizon)) as
          | 50
          | 100
          | 200,
      };
    case "chart-range":
      return { ...current, chartRange: edit.range };
    case "examples-open":
      return { ...current, [edit.role === 0 ? "examplesOpen" : "rivalExamplesOpen"]: edit.open };
  }
}
