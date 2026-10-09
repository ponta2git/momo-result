import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import * as outlookModel from "@/features/seriesComparison/model/outlook";
import { OutlookEditor } from "@/features/seriesComparison/outlook/OutlookEditor";
import { parseOutlookHorizon } from "@/features/seriesComparison/outlook/OutlookHorizonControl";
import { OutlookNoisePanel } from "@/features/seriesComparison/outlook/OutlookNoisePanel";
import {
  adoptOutlookSummary,
  applyOutlookDistribution,
  outlookPlayer,
} from "@/features/seriesComparison/outlook/outlookSession";
import { makeSeriesAnalysisOutlookSummary } from "@/test/msw/seriesAnalysisOutlookFixtures";

async function panelProps() {
  const response = await makeSeriesAnalysisOutlookSummary();
  const memberIds = ["member_eu", "member_ponta"] as const;
  const session = adoptOutlookSummary(undefined, response, "scope", [...memberIds]);
  if (!session) throw new Error("The outlook fixture must contain a comparable pair.");
  return {
    response,
    cumulative: {
      games: response.scope.matchCount,
      focusRankSum: outlookPlayer(response.players, memberIds[0]).rankSum,
      rivalRankSum: outlookPlayer(response.players, memberIds[1]).rankSum,
    },
    session,
    names: ["いーゆー", "ぽんた"] as const,
    memberIds,
  };
}

function exampleCurves() {
  return screen.getAllByLabelText(/の総合平均順位（/u).map((line) => line.getAttribute("d"));
}

describe("OutlookNoisePanel", () => {
  it("keeps example inspection within 100 games through both text and keyboard input", async () => {
    const user = userEvent.setup();
    render(<OutlookNoisePanel {...await panelProps()} active />);
    const horizon = screen.getByRole("textbox", { name: "何戦後を見る" });
    const slider = screen.getByRole("slider", { name: "グラフで確認する戦数" });
    const examples = screen.getByRole("combobox", { name: "表示する展開例" });
    expect(slider).toHaveAttribute("aria-valuemin", "1");
    expect(slider).toHaveAttribute("aria-valuemax", "100");

    await user.clear(horizon);
    await user.paste("101");
    expect(horizon).toHaveValue("101");
    expect(horizon).toHaveAttribute("aria-invalid", "true");
    expect(slider).toHaveAttribute("aria-valuenow", "20");
    expect(screen.getByRole("columnheader", { name: "20戦後" })).toBeVisible();
    expect(
      screen.getByText("1〜100の整数を入力してください。結果は20戦後のままです。"),
    ).toBeVisible();

    act(() => slider.focus());
    await user.keyboard("{End}{ArrowRight}{PageUp}");
    expect(slider).toHaveAttribute("aria-valuenow", "100");
    expect(horizon).toHaveValue("100");
    expect(horizon).not.toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("columnheader", { name: "100戦後" })).toBeVisible();

    await user.click(examples);
    await user.click(await screen.findByRole("option", { name: "展開例3" }));
    expect(examples).toHaveTextContent("展開例3");
    expect(slider).toHaveAttribute("aria-valuenow", "100");
    act(() => slider.focus());
    await user.keyboard("{Home}{ArrowLeft}{PageDown}");
    expect(slider).toHaveAttribute("aria-valuenow", "1");
    expect(horizon).toHaveValue("1");
    expect(screen.getByRole("columnheader", { name: "1戦後" })).toBeVisible();
  });

  it("stops hidden calculation and preserves its example and inspection when reactivated", async () => {
    const user = userEvent.setup();
    const props = await panelProps();
    const generate = vi.spyOn(outlookModel, "generateOutlookExamples");
    const view = render(<OutlookNoisePanel {...props} active={false} />);
    expect(view.container).toBeEmptyDOMElement();
    expect(generate).not.toHaveBeenCalled();

    view.rerender(<OutlookNoisePanel {...props} active />);
    await user.click(screen.getByRole("combobox", { name: "表示する展開例" }));
    await user.click(await screen.findByRole("option", { name: "展開例3" }));
    const horizon = screen.getByRole("textbox", { name: "何戦後を見る" });
    await user.clear(horizon);
    await user.paste("50");
    const curves = exampleCurves();
    expect(generate).toHaveBeenCalledTimes(1);

    view.rerender(<OutlookNoisePanel {...props} active={false} />);
    expect(view.container).toBeEmptyDOMElement();
    expect(generate).toHaveBeenCalledTimes(1);
    view.rerender(<OutlookNoisePanel {...props} active />);
    expect(screen.getByRole("combobox", { name: "表示する展開例" })).toHaveTextContent("展開例3");
    expect(screen.getByRole("textbox", { name: "何戦後を見る" })).toHaveValue("50");
    expect(exampleCurves()).toEqual(curves);
    expect(props.session.horizon).toBe(20);
    expect(props.session.goalHorizon).toBe(100);
    expect(generate).toHaveBeenCalledTimes(2);

    const changed = applyOutlookDistribution(
      props.session,
      0,
      outlookModel.distributionFromCounts([4, 8, 5, 3]),
      { kind: "counts" },
    );
    view.rerender(<OutlookNoisePanel {...props} session={changed} active={false} />);
    expect(view.container).toBeEmptyDOMElement();
    expect(generate).toHaveBeenCalledTimes(2);
    view.rerender(<OutlookNoisePanel {...props} session={changed} active />);
    expect(exampleCurves()).not.toEqual(curves);
    expect(generate).toHaveBeenCalledTimes(3);
  });

  it.each(["keyboard", "pointer"] as const)(
    "updates examples after a %s gesture finishes, keeping the last committed curves while editing",
    async (method) => {
      const props = await panelProps();
      const generate = vi.spyOn(outlookModel, "generateOutlookExamples");
      function Harness() {
        const [session, setSession] = useState(props.session);
        return (
          <>
            <OutlookEditor
              session={session}
              role={0}
              method="mean"
              name="いーゆー"
              change={setSession}
            />
            <OutlookNoisePanel {...props} session={session} active />
          </>
        );
      }
      render(<Harness />);
      const curves = exampleCurves();
      const slider = screen.getByRole("slider", { name: "いーゆーの平均順位を動かす" });
      if (method === "keyboard") {
        fireEvent.keyDown(slider, { key: "Home" });
        fireEvent.keyDown(slider, { key: "End" });
      } else {
        Object.assign(slider, { setPointerCapture: vi.fn() });
        fireEvent.pointerDown(slider, { pointerId: 1 });
        fireEvent.change(slider, { target: { value: "2.6" } });
        fireEvent.change(slider, { target: { value: "2.7" } });
      }
      expect(screen.getByRole("textbox", { name: "いーゆーのこれからの平均順位" })).not.toHaveValue(
        "2.85",
      );
      expect(exampleCurves()).toEqual(curves);
      expect(generate).toHaveBeenCalledTimes(1);

      if (method === "keyboard") fireEvent.keyUp(slider, { key: "End" });
      else fireEvent.pointerUp(slider, { pointerId: 1 });
      expect(exampleCurves()).not.toEqual(curves);
      expect(generate).toHaveBeenCalledTimes(2);
    },
  );

  it("retains the existing 1000-game parser limit when no maximum is specified", () => {
    expect(parseOutlookHorizon("1000")).toBe(1000);
    expect(parseOutlookHorizon("1001")).toBeUndefined();
    expect(parseOutlookHorizon("100", 100)).toBe(100);
    expect(parseOutlookHorizon("101", 100)).toBeUndefined();
  });
});
