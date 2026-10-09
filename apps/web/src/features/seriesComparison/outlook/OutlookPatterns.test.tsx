import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import * as outlookModel from "@/features/seriesComparison/model/outlook";
import { OutlookEditor } from "@/features/seriesComparison/outlook/OutlookEditor";
import { OutlookHorizonControl } from "@/features/seriesComparison/outlook/OutlookHorizonControl";
import { OutlookPatterns } from "@/features/seriesComparison/outlook/OutlookPatterns";
import {
  adoptOutlookSummary,
  applyOutlookDistribution,
  outlookPlayer,
} from "@/features/seriesComparison/outlook/outlookSession";
import { SelectField } from "@/shared/ui/forms/SelectField";
import { makeSeriesAnalysisOutlookSummary } from "@/test/msw/seriesAnalysisOutlookFixtures";
import { selectOption } from "@/test/selectOption";

async function patternProps(memberIds: readonly [string, string] = ["member_eu", "member_ponta"]) {
  const response = await makeSeriesAnalysisOutlookSummary();
  const session = adoptOutlookSummary(undefined, response, "scope", [...memberIds]);
  if (!session) throw new Error("The outlook fixture must contain a comparable pair.");
  const focus = outlookPlayer(response.players, memberIds[0]);
  const rival = outlookPlayer(response.players, memberIds[1]);
  return {
    response,
    cumulative: {
      games: response.scope.matchCount,
      focusRankSum: focus.rankSum,
      rivalRankSum: rival.rankSum,
    },
    session,
    names: [focus.displayName, rival.displayName] as const,
    memberIds,
  };
}

type PatternProps = Awaited<ReturnType<typeof patternProps>>;

function PatternsHarness({ props, editor = false }: { props: PatternProps; editor?: boolean }) {
  const [session, setSession] = useState(props.session);
  const onHorizonChange = (next: { horizon: number; horizonText: string }) =>
    setSession((current) => ({ ...current, ...next }));
  return (
    <>
      {editor ? (
        <OutlookEditor
          session={session}
          role={0}
          method="mean"
          name={props.names[0]}
          change={setSession}
        />
      ) : null}
      <OutlookPatterns
        {...props}
        session={session}
        active
        marker={null}
        onHorizonChange={onHorizonChange}
        horizonControl={
          <>
            <OutlookHorizonControl
              horizon={session.horizon}
              horizonText={session.horizonText}
              onChange={onHorizonChange}
            />
            <SelectField
              label="表示範囲"
              value={String(session.chartRange)}
              options={[100, 500, 1000].map((range) => ({
                value: String(range),
                label: `${range}戦`,
              }))}
              onValueChange={(value) =>
                setSession((current) => ({
                  ...current,
                  chartRange: Number(value) as 100 | 500 | 1000,
                }))
              }
            />
          </>
        }
      />
    </>
  );
}

function resultTable() {
  return within(screen.getByRole("table", { name: /^現在と\d+戦後の総合平均順位$/u }));
}

function rowValues(label: string) {
  return within(resultTable().getByRole("row", { name: new RegExp(`^${label}`, "u") }))
    .getAllByRole("cell")
    .map((cell) => cell.textContent);
}

function exampleValues() {
  return resultTable()
    .getAllByRole("row")
    .slice(3)
    .map((row) =>
      within(row)
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    );
}

function axisLabels(figure: HTMLElement) {
  return [...within(figure).getByRole("img").querySelectorAll("text[text-anchor='end']")].map(
    (label) => label.textContent,
  );
}

function memberLines(name: string, line: "実線" | "破線") {
  return screen.getAllByLabelText(`${name}の総合平均順位（${line}）`).map((path) => ({
    path: path.getAttribute("d"),
    color: path.getAttribute("stroke"),
    dash: path.getAttribute("stroke-dasharray"),
  }));
}

describe("OutlookPatterns", () => {
  it("shows all four patterns together and shares the 1000-game observation across their table and graphs", async () => {
    const user = userEvent.setup();
    const props = await patternProps();
    const generate = vi.spyOn(outlookModel, "generateOutlookExamples");
    render(<PatternsHarness props={props} />);
    expect(
      resultTable()
        .getAllByRole("rowheader")
        .map((cell) => cell.textContent),
    ).toEqual(["現在", "平均", "有利な例", "中間の例", "不利な例"]);
    expect(rowValues("現在")).toEqual(["2.31位", "2.44位"]);
    expect(rowValues("平均")).toEqual(["2.52位", "2.44位"]);
    for (const name of ["平均", "有利な例", "中間の例", "不利な例"]) {
      const figure = within(screen.getByRole("figure", { name }));
      expect(figure.getByLabelText("いーゆーの総合平均順位（実線）")).toBeInTheDocument();
      expect(figure.getByLabelText("ぽんたの総合平均順位（破線）")).toBeInTheDocument();
    }
    const sliders = screen.getAllByRole("slider");
    for (const slider of sliders) {
      expect(slider).toHaveAttribute("aria-valuemin", "1");
      expect(slider).toHaveAttribute("aria-valuemax", "1000");
    }
    const horizon = screen.getByRole("textbox", { name: "何戦後を見る" });
    await user.clear(horizon);
    await user.paste("1001");
    expect(horizon).toHaveValue("1001");
    expect(horizon).toHaveAttribute("aria-invalid", "true");
    for (const slider of sliders) expect(slider).toHaveAttribute("aria-valuenow", "20");
    expect(screen.getByRole("table", { name: "現在と20戦後の総合平均順位" })).toBeVisible();

    const exampleSlider = screen.getByRole("slider", { name: "有利な例のグラフで確認する戦数" });
    act(() => exampleSlider.focus());
    await user.keyboard("{End}{ArrowRight}{PageUp}");
    expect(horizon).toHaveValue("1000");
    expect(horizon).not.toHaveAttribute("aria-invalid", "true");
    for (const slider of sliders) expect(slider).toHaveAttribute("aria-valuenow", "1000");
    expect(screen.getByRole("table", { name: "現在と1000戦後の総合平均順位" })).toBeVisible();
    for (const chart of screen.getAllByRole("img"))
      expect(chart).toHaveAccessibleName(/確認する時点は1000戦後（グラフの範囲外）/u);
    expect(generate).toHaveBeenCalledTimes(1);
    const generated = generate.mock.results[0];
    if (generated?.type !== "return") throw new Error("The visible patterns must be generated.");
    const expected = generated.value.examples.map((example) => {
      const point = example.points[1000]!;
      return [`${point.focusAverage.toFixed(2)}位`, `${point.rivalAverage.toFixed(2)}位`];
    });
    expect(exampleValues().toSorted()).toEqual(expected.toSorted());

    await selectOption(user, screen.getByRole("combobox", { name: "表示範囲" }), "1000");
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate).toHaveBeenLastCalledWith(expect.objectContaining({ selectionRange: 1000 }));
    for (const figure of screen.getAllByRole("figure").slice(1)) {
      const line = within(figure).getByLabelText("いーゆーの総合平均順位（実線）");
      expect(line.getAttribute("d")?.match(/[ML]/gu)).toHaveLength(1001);
    }
    const averageSlider = screen.getByRole("slider", { name: "平均のグラフで確認する戦数" });
    act(() => averageSlider.focus());
    await user.keyboard("{Home}{ArrowLeft}{PageDown}");
    expect(horizon).toHaveValue("1");
    for (const slider of screen.getAllByRole("slider"))
      expect(slider).toHaveAttribute("aria-valuenow", "1");
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("stops calculation while inactive and uses the current conditions when shown again", async () => {
    const props = await patternProps();
    const generate = vi.spyOn(outlookModel, "generateOutlookExamples");
    const tree = (active: boolean, session = props.session) => (
      <OutlookPatterns
        {...props}
        session={session}
        active={active}
        marker={null}
        horizonControl={null}
        onHorizonChange={() => undefined}
      />
    );
    const view = render(tree(false));
    expect(view.container).toBeEmptyDOMElement();
    expect(generate).not.toHaveBeenCalled();
    view.rerender(tree(true));
    const original = exampleValues();
    expect(generate).toHaveBeenCalledTimes(1);
    view.rerender(tree(false));
    expect(view.container).toBeEmptyDOMElement();
    view.rerender(tree(true));
    expect(exampleValues()).toEqual(original);
    expect(generate).toHaveBeenCalledTimes(2);
    const changed = applyOutlookDistribution(
      props.session,
      0,
      outlookModel.distributionFromCounts([4, 8, 5, 3]),
      { kind: "counts" },
    );
    view.rerender(tree(false, changed));
    expect(view.container).toBeEmptyDOMElement();
    expect(generate).toHaveBeenCalledTimes(2);
    view.rerender(tree(true, changed));
    expect(exampleValues()).not.toEqual(original);
    expect(generate).toHaveBeenCalledTimes(3);
  });

  it("shares fitted axes across all patterns and changes them for conditions, not the observation position", async () => {
    const user = userEvent.setup();
    const props = await patternProps();
    props.session.chartRange = 1000;
    render(<PatternsHarness props={props} editor />);
    const axes = axisLabels(screen.getByRole("figure", { name: "平均" }));
    expect(Number(axes[0])).toBeGreaterThan(1);
    expect(Number(axes.at(-1))).toBeLessThan(4);
    for (const figure of screen.getAllByRole("figure")) expect(axisLabels(figure)).toEqual(axes);
    const horizon = screen.getByRole("textbox", { name: "何戦後を見る" });
    await user.clear(horizon);
    await user.paste("450");
    for (const figure of screen.getAllByRole("figure")) expect(axisLabels(figure)).toEqual(axes);
    const mean = screen.getByRole("textbox", { name: "いーゆーのこれからの平均順位" });
    await user.clear(mean);
    await user.type(mean, "3.65{Enter}");
    const changed = axisLabels(screen.getByRole("figure", { name: "平均" }));
    expect(changed).not.toEqual(axes);
    for (const figure of screen.getAllByRole("figure")) expect(axisLabels(figure)).toEqual(changed);
  });

  it("keeps canonical person columns and line identities when focus and rival are reversed", async () => {
    const props = await patternProps();
    const view = render(<PatternsHarness key={props.session.key} props={props} />);
    const eu = memberLines("いーゆー", "実線");
    const ponta = memberLines("ぽんた", "破線");
    const favorable = rowValues("有利な例");
    const unfavorable = rowValues("不利な例");
    const reversed = await patternProps(["member_ponta", "member_eu"]);
    view.rerender(<PatternsHarness key={reversed.session.key} props={reversed} />);
    expect(
      resultTable()
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent),
    ).toEqual(["展開", "いーゆー", "ぽんた"]);
    expect(rowValues("有利な例")).toEqual(unfavorable);
    expect(rowValues("不利な例")).toEqual(favorable);
    expect(memberLines("いーゆー", "実線")).toEqual(expect.arrayContaining(eu));
    expect(memberLines("ぽんた", "破線")).toEqual(expect.arrayContaining(ponta));
  });

  it("uses neutral labels when all examples have the same difference trajectory", async () => {
    const props = await patternProps();
    props.session.entries = [
      {
        distribution: outlookModel.distributionFromCounts([20, 0, 0, 0]),
        source: { kind: "counts" },
      },
      {
        distribution: outlookModel.distributionFromCounts([0, 20, 0, 0]),
        source: { kind: "counts" },
      },
    ];
    render(<PatternsHarness props={props} />);
    expect(
      resultTable()
        .getAllByRole("rowheader")
        .map((cell) => cell.textContent),
    ).toEqual(["現在", "平均", "展開例1", "展開例2", "展開例3"]);
    expect(
      screen.getByText(/この内訳では、どの展開例も2人の差は同じ推移になります/u),
    ).toBeVisible();
    for (const label of ["展開例1", "展開例2", "展開例3"]) {
      expect(screen.getByRole("figure", { name: label })).toBeVisible();
      expect(rowValues(label)).toEqual(rowValues("平均"));
    }
  });

  it.each(["keyboard", "pointer"] as const)(
    "updates example values after a %s gesture finishes while the average stays live",
    async (method) => {
      const props = await patternProps();
      const generate = vi.spyOn(outlookModel, "generateOutlookExamples");
      render(<PatternsHarness props={props} editor />);
      const examples = exampleValues();
      const average = rowValues("平均");
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
      expect(rowValues("平均")).not.toEqual(average);
      expect(exampleValues()).toEqual(examples);
      expect(generate).toHaveBeenCalledTimes(1);
      if (method === "keyboard") fireEvent.keyUp(slider, { key: "End" });
      else fireEvent.pointerUp(slider, { pointerId: 1 });
      expect(exampleValues()).not.toEqual(examples);
      expect(generate).toHaveBeenCalledTimes(2);
    },
  );
});
