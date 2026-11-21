import { describe, expect, it } from "vitest";

import {
  distributionFromCounts,
  distributionMean,
  rational,
  requiredMean,
} from "@/features/seriesComparison/outlook/calculation";
import { editOutlook, outlookChartRange } from "@/features/seriesComparison/outlook/outlookEditing";
import {
  outlookExampleBlock,
  outlookGoalBlock,
} from "@/features/seriesComparison/outlook/outlookProposals";
import type { OutlookGoalExpectation } from "@/features/seriesComparison/outlook/outlookProposals";
import {
  adoptOutlookSummary,
  recentOutlookEntry,
} from "@/features/seriesComparison/outlook/outlookWorkspaceState";
import type { OutlookWorkspaceState } from "@/features/seriesComparison/outlook/outlookWorkspaceState";
import type { SeriesAnalysisOutlookSummary } from "@/shared/api/seriesAnalysis";
import {
  makeCorrectedOutlookSummary,
  makeSeriesAnalysisOutlookExamples,
  makeSeriesAnalysisOutlookSummary,
  makeShortWindowOutlookSummary,
} from "@/test/msw/seriesAnalysisOutlookFixtures";

const ids: [string, string] = ["member_eu", "member_ponta"];

function start(summary: SeriesAnalysisOutlookSummary): OutlookWorkspaceState {
  const state = adoptOutlookSummary(undefined, summary, "scope", ids);
  if (!state) throw new Error("The fixture must be adoptable.");
  return state;
}
const mean = (state: OutlookWorkspaceState, role: 0 | 1) =>
  distributionMean(state.entries[role].distribution);
function expectation(state: OutlookWorkspaceState, summary: SeriesAnalysisOutlookSummary) {
  const focus = summary.players.find((player) => player.memberId === ids[0])!;
  const rival = summary.players.find((player) => player.memberId === ids[1])!;
  return {
    key: state.key,
    artifactId: state.artifactId,
    horizon: state.goalHorizon,
    rival: state.entries[1].distribution,
    cumulative: {
      games: summary.scope.matchCount,
      focusRankSum: focus.rankSum,
      rivalRankSum: rival.rankSum,
    },
  } satisfies OutlookGoalExpectation;
}

describe("outlook editing", () => {
  it("keeps an exact short-window mean when the same value is entered again", async () => {
    const state = start(await makeShortWindowOutlookSummary());
    expect(mean(state, 0)).toEqual(rational(4n, 3n));
    const drafted = editOutlook(state, { kind: "mean-draft", role: 0, text: "1.3333" });
    const committed = editOutlook(drafted, { kind: "commit-mean", role: 0 });
    expect(committed.entries[0].distribution).toBe(state.entries[0].distribution);
    expect(committed.entries[0].meanDraft).toBeUndefined();
  });

  it("restores the exact start, source included, when a gesture is cancelled or ends where it began", async () => {
    const state = start(await makeSeriesAnalysisOutlookSummary());
    const moved = editOutlook(editOutlook(state, { kind: "begin-gesture", role: 0 }), {
      kind: "mean",
      role: 0,
      hundredths: 260,
    });
    expect(mean(moved, 0)).toEqual(rational(13n, 5n));
    const cancelled = editOutlook(moved, { kind: "finish-gesture", cancel: true });
    expect(cancelled.entries[0]).toMatchObject(state.entries[0]);
    expect(cancelled.gesture).toBeUndefined();
    const back = editOutlook(moved, { kind: "mean", role: 0, hundredths: 285 });
    const ended = editOutlook(back, { kind: "finish-gesture", cancel: false });
    expect(ended.entries[0].source.kind).toBe("recent");
  });

  it("refuses a recent reset that cannot share games with the rival, changing neither person", async () => {
    const summary = await makeSeriesAnalysisOutlookSummary();
    const state = start(summary);
    // The rival takes every third place, so the focus person's recent third places cannot return.
    const focusAway: OutlookWorkspaceState = {
      ...state,
      entries: [
        { ...state.entries[0], distribution: distributionFromCounts([0, 20, 0, 0]) },
        { ...state.entries[1], distribution: distributionFromCounts([0, 0, 20, 0]) },
      ],
    };
    const refused = editOutlook(focusAway, {
      kind: "restore-recent",
      role: 0,
      recent: recentOutlookEntry(summary, ids[0]),
    });
    expect(refused.entries[0].distribution).toBe(focusAway.entries[0].distribution);
    expect(refused.entries[1].distribution).toBe(focusAway.entries[1].distribution);
    expect(refused.entries[0].error).toMatch(/3位/u);
  });

  it("keeps the last valid goal while its text is incomplete or out of range", async () => {
    const state = start(await makeSeriesAnalysisOutlookSummary());
    const blank = editOutlook(state, { kind: "goal-horizon", text: "" });
    expect(blank).toMatchObject({ goalHorizon: 100, goalHorizonText: "" });
    const tooLong = editOutlook(blank, { kind: "goal-horizon", text: "1001" });
    expect(tooLong.goalHorizon).toBe(100);
    expect(outlookGoalBlock(tooLong)).toBe("invalid-goal");
    expect(editOutlook(tooLong, { kind: "goal-horizon", text: "300" }).goalHorizon).toBe(300);
    expect([50, 51, 100, 101, 200, 1000].map(outlookChartRange)).toEqual([
      50, 100, 100, 200, 200, 200,
    ]);
  });

  describe("applying the goal's required mean", () => {
    it("replaces the focus person's unapplied text but waits for the rival's", async () => {
      const summary = await makeSeriesAnalysisOutlookSummary();
      const state = start(summary);
      const expected = expectation(state, summary);
      const maximum = requiredMean(expected.cumulative, expected.rival, 100).maximumHundredths!;
      const rivalPending = editOutlook(state, { kind: "mean-draft", role: 1, text: "2.30" });
      expect(outlookGoalBlock(rivalPending)).toBe("rival-pending");
      expect(
        editOutlook(rivalPending, { kind: "apply-goal", expected, maximumHundredths: maximum }),
      ).toBe(rivalPending);
      const focusPending = editOutlook(state, { kind: "mean-draft", role: 0, text: "2.90" });
      const applied = editOutlook(focusPending, {
        kind: "apply-goal",
        expected,
        maximumHundredths: maximum,
      });
      expect(mean(applied, 0)).toEqual(rational(BigInt(maximum), 100n));
      expect(applied.entries[0]).toMatchObject({
        meanDraft: undefined,
        source: { kind: "average" },
      });
      expect(applied.entries[1]).toBe(state.entries[1]);
    });

    it("marks a changed condition instead of applying it, and never weakens a met goal", async () => {
      const summary = await makeSeriesAnalysisOutlookSummary();
      const state = start(summary);
      const expected = expectation(state, summary);
      const maximum = requiredMean(expected.cumulative, expected.rival, 100).maximumHundredths!;
      const moved = editOutlook(state, { kind: "goal-horizon", text: "50" });
      expect(
        editOutlook(moved, { kind: "apply-goal", expected, maximumHundredths: maximum }).rejection,
      ).toBe("goal");
      const strong = editOutlook(state, { kind: "mean", role: 0, hundredths: 200 });
      const kept = editOutlook(strong, {
        kind: "apply-goal",
        expected: expectation(strong, summary),
        maximumHundredths: maximum,
      });
      expect(kept).toBe(strong);
    });
  });

  describe("applying a past example", () => {
    it("waits for either person's unapplied text and then sets only the focus person", async () => {
      const summary = await makeSeriesAnalysisOutlookSummary();
      const examples = await makeSeriesAnalysisOutlookExamples({ memberId: ids[0] });
      const state = start(summary);
      const expected = expectation(state, summary);
      const { threshold } = requiredMean(expected.cumulative, expected.rival, 100);
      const example = examples.examples.types.find(
        (candidate) =>
          distributionMean(distributionFromCounts(candidate.rankCounts)).numerator *
            threshold.denominator <
          threshold.numerator *
            distributionMean(distributionFromCounts(candidate.rankCounts)).denominator,
      )!;
      const focusPending = editOutlook(state, { kind: "mean-draft", role: 0, text: "2.90" });
      expect(outlookExampleBlock(focusPending)).toBe("pending");
      expect(editOutlook(focusPending, { kind: "apply-example", expected, example })).toBe(
        focusPending,
      );
      const applied = editOutlook(state, { kind: "apply-example", expected, example });
      expect(applied.entries[0].distribution).toEqual(distributionFromCounts(example.rankCounts));
      expect(applied.entries[0].source).toMatchObject({
        kind: "example",
        artifactId: state.artifactId,
      });
      expect(applied.entries[1]).toBe(state.entries[1]);
      const moved = editOutlook(state, { kind: "goal-horizon", text: "50" });
      expect(editOutlook(moved, { kind: "apply-example", expected, example }).rejection).toBe(
        "example",
      );
    });
  });

  describe("adopting a newer artifact", () => {
    it("follows untouched recent results, keeps a pending draft, and says so until dismissed", async () => {
      const summary = await makeSeriesAnalysisOutlookSummary();
      const drafted = editOutlook(start(summary), { kind: "mean-draft", role: 0, text: "2.60" });
      const corrected = await makeCorrectedOutlookSummary(summary);
      const adopted = adoptOutlookSummary(drafted, corrected, "scope", ids)!;
      expect(adopted.entries[1].distribution).toEqual(
        recentOutlookEntry(corrected, ids[1]).distribution,
      );
      expect(adopted.entries[0].meanDraft).toBe("2.60");
      expect(adopted.notice).toBe("followed-recent");
      const edited = editOutlook(adopted, { kind: "mean", role: 1, hundredths: 240 });
      expect(edited.notice).toBe("followed-recent");
      expect(editOutlook(edited, { kind: "dismiss-notice" }).notice).toBeUndefined();
    });

    it("keeps edited assumptions with their earlier origin", async () => {
      const summary = await makeSeriesAnalysisOutlookSummary();
      const edited = editOutlook(start(summary), { kind: "mean", role: 0, hundredths: 260 });
      const adopted = adoptOutlookSummary(
        edited,
        await makeCorrectedOutlookSummary(summary),
        "scope",
        ids,
      )!;
      expect(adopted.entries).toEqual(edited.entries);
      expect(adopted.entries[1].source).toMatchObject({
        kind: "recent",
        artifactId: summary.artifact.artifactId,
      });
      expect(adopted.notice).toBe("kept-assumptions");
    });
  });
});
