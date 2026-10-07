import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { OutlookChartScrubber } from "@/features/seriesComparison/outlook/OutlookChartScrubber";

function ScrubberHarness({
  horizon = 20,
  horizonText = String(horizon),
}: {
  horizon?: number;
  horizonText?: string;
}) {
  const [selection, setSelection] = useState({ horizon, horizonText });
  return (
    <>
      <p id="scrubber-description">確認する戦数を選びます。</p>
      <OutlookChartScrubber
        {...selection}
        valueText={`${selection.horizon}戦後`}
        descriptionId="scrubber-description"
        onChange={setSelection}
      />
      <output aria-label="入力中の戦数">{selection.horizonText}</output>
    </>
  );
}

function renderScrubber(horizon = 20, horizonText = String(horizon)) {
  render(<ScrubberHarness horizon={horizon} horizonText={horizonText} />);
  const slider = screen.getByRole("slider", { name: "グラフで確認する戦数" });
  vi.spyOn(slider, "getBoundingClientRect").mockReturnValue(new DOMRect(100, 40, 400, 188));
  const captured = new Set<number>();
  Object.assign(slider, {
    setPointerCapture: (pointerId: number) => captured.add(pointerId),
    hasPointerCapture: (pointerId: number) => captured.has(pointerId),
    releasePointerCapture: (pointerId: number) => captured.delete(pointerId),
  });
  return slider;
}

function pointer(clientX: number, clientY = 80) {
  return { pointerId: 1, pointerType: "touch", isPrimary: true, button: 0, clientX, clientY };
}

describe("OutlookChartScrubber", () => {
  it("exposes the actual horizon and supports bounded keyboard steps beyond the plotted range", async () => {
    const user = userEvent.setup();
    const slider = renderScrubber(101);
    expect(slider).toHaveAttribute("aria-valuemin", "1");
    expect(slider).toHaveAttribute("aria-valuemax", "1000");
    expect(slider).toHaveAttribute("aria-valuenow", "101");
    expect(slider).toHaveAttribute("aria-valuetext", "101戦後");
    await user.tab();
    expect(slider).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(slider).toHaveAttribute("aria-valuenow", "100");
    await user.keyboard("{ArrowDown}");
    expect(slider).toHaveAttribute("aria-valuenow", "99");
    await user.keyboard("{ArrowRight}{ArrowUp}{PageDown}");
    expect(slider).toHaveAttribute("aria-valuenow", "91");
    await user.keyboard("{PageUp}");
    expect(slider).toHaveAttribute("aria-valuenow", "101");
    await user.keyboard("{End}{ArrowRight}{PageUp}");
    expect(slider).toHaveAttribute("aria-valuenow", "1000");
    expect(screen.getByLabelText("入力中の戦数")).toHaveTextContent("1000");
    await user.keyboard("{Home}{ArrowLeft}{PageDown}");
    expect(slider).toHaveAttribute("aria-valuenow", "1");
    expect(screen.getByLabelText("入力中の戦数")).toHaveTextContent("1");
  });

  it("selects a tap or horizontal drag within 1–100 without changing the horizon during a vertical gesture", () => {
    const slider = renderScrubber();
    fireEvent.pointerDown(slider, pointer(300));
    expect(slider).toHaveAttribute("aria-valuenow", "20");
    fireEvent.pointerUp(slider, pointer(300));
    expect(slider).toHaveAttribute("aria-valuenow", "50");
    fireEvent.pointerDown(slider, pointer(300));
    fireEvent.pointerMove(slider, pointer(380, 83));
    expect(slider).toHaveAttribute("aria-valuenow", "70");
    fireEvent.pointerMove(slider, pointer(80));
    expect(slider).toHaveAttribute("aria-valuenow", "1");
    fireEvent.pointerMove(slider, pointer(540));
    expect(slider).toHaveAttribute("aria-valuenow", "100");
    fireEvent.pointerUp(slider, pointer(540));
    expect(screen.getByLabelText("入力中の戦数")).toHaveTextContent("100");
    fireEvent.pointerDown(slider, pointer(300));
    fireEvent.pointerMove(slider, pointer(303, 140));
    fireEvent.pointerMove(slider, pointer(450, 145));
    fireEvent.pointerUp(slider, pointer(450, 145));
    expect(slider).toHaveAttribute("aria-valuenow", "100");
    expect(screen.getByLabelText("入力中の戦数")).toHaveTextContent("100");
  });

  it.each(["pointer cancel", "lost capture", "Escape"] as const)(
    "restores the starting horizon and unfinished text after %s",
    async (cancel) => {
      const user = userEvent.setup();
      const slider = renderScrubber(140, "");
      fireEvent.pointerDown(slider, pointer(180));
      fireEvent.pointerMove(slider, pointer(380));
      expect(slider).toHaveAttribute("aria-valuenow", "70");
      expect(screen.getByLabelText("入力中の戦数")).toHaveTextContent("70");
      if (cancel === "pointer cancel") fireEvent.pointerCancel(slider, pointer(380));
      else if (cancel === "lost capture") fireEvent.lostPointerCapture(slider, pointer(380));
      else await user.keyboard("{Escape}");
      expect(slider).toHaveAttribute("aria-valuenow", "140");
      expect(screen.getByLabelText("入力中の戦数")).toBeEmptyDOMElement();
      fireEvent.pointerUp(slider, pointer(500));
      expect(slider).toHaveAttribute("aria-valuenow", "140");
      expect(screen.getByLabelText("入力中の戦数")).toBeEmptyDOMElement();
    },
  );
});
