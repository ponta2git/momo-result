import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { outlookResultView } from "@/features/seriesComparison/outlook/outlookProjections";
import {
  OutlookWorkspaceProvider,
  OutlookSummaryBoundary,
  useOutlookEdit,
  useOutlookProjection,
} from "@/features/seriesComparison/outlook/OutlookWorkspaceProvider";
import { useOutlookPlayerEditor } from "@/features/seriesComparison/outlook/useOutlookPlayerEditor";
import { makeSeriesAnalysisOutlookSummary } from "@/test/msw/seriesAnalysisOutlookFixtures";

describe("Outlook state subscriptions", () => {
  it("keeps the answers' snapshot while a mean is typed and publishes it once committed", async () => {
    const response = await makeSeriesAnalysisOutlookSummary();
    const selection = {
      gameTitleId: response.artifact.gameTitleId,
      focusMemberId: "member_eu",
      rivalMemberId: "member_ponta",
    };
    const { result } = renderHook(
      () => ({
        result: useOutlookProjection(outlookResultView),
        edit: useOutlookEdit(),
        player: useOutlookPlayerEditor({ response, role: 0, memberId: selection.focusMemberId }),
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
    expect(result.current.player.view.meanDraft).toBe("2.40");
    expect(result.current.result).toBe(initial);
    act(() => result.current.edit({ kind: "commit-mean", role: 0 }));
    expect(result.current.player.view.meanDraft).toBeUndefined();
    expect(result.current.result).not.toBe(initial);
    expect(result.current.result.focus).not.toBe(initial.focus);
  });
});
