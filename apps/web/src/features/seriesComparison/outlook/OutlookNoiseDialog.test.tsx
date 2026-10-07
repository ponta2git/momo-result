import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { parseOutlookHorizon } from "@/features/seriesComparison/outlook/OutlookHorizonControl";
import { OutlookNoiseDialog } from "@/features/seriesComparison/outlook/OutlookNoiseDialog";
import {
  adoptOutlookSummary,
  outlookPlayer,
} from "@/features/seriesComparison/outlook/outlookSession";
import { makeSeriesAnalysisOutlookSummary } from "@/test/msw/seriesAnalysisOutlookFixtures";

describe("OutlookNoiseDialog", () => {
  it("keeps example inspection within 100 games through both text and keyboard input", async () => {
    const user = userEvent.setup();
    const response = await makeSeriesAnalysisOutlookSummary();
    const memberIds = ["member_eu", "member_ponta"] as const;
    const session = adoptOutlookSummary(undefined, response, "scope", [...memberIds]);
    if (!session) throw new Error("The outlook fixture must contain a comparable pair.");
    render(
      <OutlookNoiseDialog
        response={response}
        cumulative={{
          games: response.scope.matchCount,
          focusRankSum: outlookPlayer(response.players, memberIds[0]).rankSum,
          rivalRankSum: outlookPlayer(response.players, memberIds[1]).rankSum,
        }}
        session={session}
        names={["いーゆー", "ぽんた"]}
        memberIds={memberIds}
      />,
    );
    await user.click(screen.getByRole("button", { name: "試合ごとのブレを見る" }));
    const dialog = within(await screen.findByRole("dialog", { name: "試合ごとの順位が変わると" }));
    const horizon = dialog.getByRole("textbox", { name: "何戦後を見る" });
    const slider = dialog.getByRole("slider", { name: "グラフで確認する戦数" });
    const examples = dialog.getByRole("combobox", { name: "表示する展開例" });
    expect(slider).toHaveAttribute("aria-valuemin", "1");
    expect(slider).toHaveAttribute("aria-valuemax", "100");

    await user.clear(horizon);
    await user.paste("101");
    expect(horizon).toHaveValue("101");
    expect(horizon).toHaveAttribute("aria-invalid", "true");
    expect(slider).toHaveAttribute("aria-valuenow", "20");
    expect(dialog.getByRole("columnheader", { name: "20戦後" })).toBeVisible();
    expect(
      dialog.getByText("1〜100の整数を入力してください。結果は20戦後のままです。"),
    ).toBeVisible();

    act(() => slider.focus());
    await user.keyboard("{End}{ArrowRight}{PageUp}");
    expect(slider).toHaveAttribute("aria-valuenow", "100");
    expect(horizon).toHaveValue("100");
    expect(horizon).not.toHaveAttribute("aria-invalid", "true");
    expect(dialog.getByRole("columnheader", { name: "100戦後" })).toBeVisible();

    await user.click(examples);
    await user.click(await screen.findByRole("option", { name: "展開例3" }));
    expect(examples).toHaveTextContent("展開例3");
    expect(slider).toHaveAttribute("aria-valuenow", "100");
    act(() => slider.focus());
    await user.keyboard("{Home}{ArrowLeft}{PageDown}");
    expect(slider).toHaveAttribute("aria-valuenow", "1");
    expect(horizon).toHaveValue("1");
    expect(dialog.getByRole("columnheader", { name: "1戦後" })).toBeVisible();
  });

  it("retains the existing 1000-game parser limit when no maximum is specified", () => {
    expect(parseOutlookHorizon("1000")).toBe(1000);
    expect(parseOutlookHorizon("1001")).toBeUndefined();
    expect(parseOutlookHorizon("100", 100)).toBe(100);
    expect(parseOutlookHorizon("101", 100)).toBeUndefined();
  });
});
