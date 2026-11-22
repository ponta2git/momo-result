import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChartInspectionProvider } from "@/features/seriesComparison/outlook/workspace/chart/ChartInspection";
import { ChartScrubber } from "@/features/seriesComparison/outlook/workspace/chart/ChartScrubber";

function renderPair() {
  render(
    <ChartInspectionProvider range={100}>
      {["差", "必要な平均"].map((label) => (
        <ChartScrubber
          key={label}
          range={100}
          plot={{ left: 0, right: 200 }}
          label={label}
          valueText={(h) => `${label} ${h}戦後`}
        >
          <svg aria-hidden="true" />
        </ChartScrubber>
      ))}
    </ChartInspectionProvider>,
  );
  const [gap, need] = screen.getAllByRole("slider");
  if (!gap || !need) throw new Error("Both graphs must render.");
  for (const slider of [gap, need])
    slider.getBoundingClientRect = () => new DOMRect(0, 0, 200, 100);
  return { gap, need };
}

describe("ChartScrubber", () => {
  it("steps the shared position with the keyboard and closes it with Escape", () => {
    const { gap, need } = renderPair();
    fireEvent.focus(gap);
    expect(gap).toHaveAttribute("aria-valuenow", "100");
    fireEvent.keyDown(gap, { key: "Home" });
    fireEvent.keyDown(gap, { key: "ArrowRight" });
    fireEvent.keyDown(gap, { key: "PageUp" });
    expect(gap).toHaveAttribute("aria-valuetext", "差 11戦後");
    expect(need).toHaveAttribute("aria-valuetext", "必要な平均 11戦後");
    fireEvent.keyDown(gap, { key: "End" });
    fireEvent.keyDown(gap, { key: "ArrowRight" });
    expect(gap).toHaveAttribute("aria-valuenow", "100");
    fireEvent.keyDown(gap, { key: "Escape" });
    expect(gap).toHaveAttribute("aria-valuenow", "100");
  });

  it("reads where a touch lands and restores the earlier position when the page takes the gesture", () => {
    const { gap } = renderPair();
    fireEvent.pointerDown(gap, {
      pointerId: 1,
      pointerType: "touch",
      isPrimary: true,
      clientX: 50,
    });
    expect(gap).toHaveAttribute("aria-valuenow", "25");
    fireEvent.pointerMove(gap, { pointerId: 1, pointerType: "touch", clientX: 100 });
    expect(gap).toHaveAttribute("aria-valuenow", "50");
    fireEvent.pointerUp(gap, { pointerId: 1, pointerType: "touch" });
    fireEvent.pointerDown(gap, {
      pointerId: 2,
      pointerType: "touch",
      isPrimary: true,
      clientX: 180,
    });
    expect(gap).toHaveAttribute("aria-valuenow", "90");
    fireEvent.pointerCancel(gap, { pointerId: 2, pointerType: "touch" });
    expect(gap).toHaveAttribute("aria-valuenow", "50");
  });
});
