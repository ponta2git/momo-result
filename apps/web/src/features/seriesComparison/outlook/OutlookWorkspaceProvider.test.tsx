import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { outlookComparisonView } from "@/features/seriesComparison/outlook/outlookProjections";
import {
  OutlookWorkspaceProvider,
  OutlookSummaryBoundary,
  useOutlookEdit,
} from "@/features/seriesComparison/outlook/OutlookWorkspaceProvider";
import { useOutlookPlayerEditor } from "@/features/seriesComparison/outlook/useOutlookPlayerEditor";
import { useOutlookResultView } from "@/features/seriesComparison/outlook/useOutlookWorkspace";
import { makeSeriesAnalysisOutlookSummary } from "@/test/msw/seriesAnalysisOutlookFixtures";

describe("Outlook state subscriptions", () => {
  it("preserves the result snapshot for input drafts and reference disclosure, and publishes committed performance", async () => {
    const response = await makeSeriesAnalysisOutlookSummary();
    const selection = {
      gameTitleId: response.artifact.gameTitleId,
      focusMemberId: "member_eu",
      rivalMemberId: "member_ponta",
    };
    const comparison = outlookComparisonView(
      response,
      selection.focusMemberId,
      selection.rivalMemberId,
    );
    const { result } = renderHook(
      () => ({
        result: useOutlookResultView(),
        edit: useOutlookEdit(),
        player: useOutlookPlayerEditor({
          response,
          role: 0,
          memberId: comparison.ids[0],
          cumulative: comparison.cumulative,
          names: comparison.names,
          showComparison: true,
        }),
      }),
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <OutlookWorkspaceProvider>
            <OutlookSummaryBoundary response={response} selection={selection} empty={null}>
              {children}
            </OutlookSummaryBoundary>
          </OutlookWorkspaceProvider>
        ),
      },
    );
    const initial = result.current.result;
    act(() => result.current.edit({ kind: "mean-draft", role: 0, text: "2.40" }));
    expect(result.current.player.editor.meanDraft).toBe("2.40");
    expect(result.current.result).toBe(initial);
    act(() => result.current.edit({ kind: "examples-open", role: 1, open: true }));
    expect(result.current.result).toBe(initial);
    act(() => result.current.edit({ kind: "commit-mean", role: 0 }));
    expect(result.current.player.editor.meanDraft).toBeUndefined();
    expect(result.current.result).not.toBe(initial);
    expect(result.current.result.focus).not.toBe(initial.focus);
  });
});
