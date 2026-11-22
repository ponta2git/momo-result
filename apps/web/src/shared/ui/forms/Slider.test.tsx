import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { Slider } from "@/shared/ui/forms/Slider";

function Harness({ initial = 2.4105 }: { initial?: number }) {
  const [value, setValue] = useState(initial);
  const calls = Harness.calls;
  return (
    <Slider
      aria-label="平均順位"
      value={value}
      min={1.35}
      max={3.65}
      valueText={`${value}位`}
      marks={[{ value: 2.85, label: "直近" }]}
      onStep={(direction, large) => {
        calls.step(direction, large);
        setValue((current) => Math.round((current + direction * (large ? 0.1 : 0.01)) * 100) / 100);
      }}
      onBoundary={calls.boundary}
      onDrag={calls.drag}
      onGestureStart={calls.start}
      onGestureEnd={calls.end}
    />
  );
}
Harness.calls = {
  step: vi.fn(),
  boundary: vi.fn(),
  drag: vi.fn(),
  start: vi.fn(),
  end: vi.fn(),
};
function resetCalls() {
  for (const call of Object.values(Harness.calls)) call.mockClear();
}

describe("Slider", () => {
  it("shows an exact value between steps without changing it on focus", async () => {
    resetCalls();
    const user = userEvent.setup();
    render(<Harness />);
    const slider = screen.getByRole("slider", { name: "平均順位" });
    await user.tab();
    expect(slider).toHaveFocus();
    expect(slider).toHaveAttribute("aria-valuenow", "2.4105");
    expect(slider).toHaveAttribute("aria-valuetext", "2.4105位");
    expect(Harness.calls.drag).not.toHaveBeenCalled();
    expect(Harness.calls.step).not.toHaveBeenCalled();
  });

  it("lets the consumer decide every key and treats a key hold as one operation", () => {
    resetCalls();
    render(<Harness />);
    const slider = screen.getByRole("slider", { name: "平均順位" });
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    fireEvent.keyDown(slider, { key: "ArrowLeft", repeat: true });
    fireEvent.keyUp(slider, { key: "ArrowLeft" });
    fireEvent.keyDown(slider, { key: "PageUp" });
    fireEvent.keyUp(slider, { key: "PageUp" });
    fireEvent.keyDown(slider, { key: "Home" });
    fireEvent.keyUp(slider, { key: "Home" });
    expect(Harness.calls.step.mock.calls).toEqual([
      [-1, false],
      [-1, false],
      [1, true],
    ]);
    expect(Harness.calls.boundary).toHaveBeenCalledWith("min");
    expect(Harness.calls.start).toHaveBeenCalledTimes(3);
    expect(Harness.calls.end.mock.calls).toEqual([
      [{ canceled: false }],
      [{ canceled: false }],
      [{ canceled: false }],
    ]);
  });

  it("cancels the operation with Escape and ignores keys until the next one starts", () => {
    resetCalls();
    render(<Harness />);
    const slider = screen.getByRole("slider", { name: "平均順位" });
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    fireEvent.keyDown(slider, { key: "Escape" });
    fireEvent.keyUp(slider, { key: "ArrowRight" });
    expect(Harness.calls.end.mock.calls).toEqual([[{ canceled: true }]]);
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(Harness.calls.step).toHaveBeenCalledTimes(2);
  });

  it("ends a pointer operation on release or lost capture and cancels it on pointer cancel", () => {
    resetCalls();
    const { container } = render(<Harness />);
    const root = container.firstElementChild?.children[1];
    if (!(root instanceof HTMLElement)) throw new Error("The slider root must render.");
    fireEvent.pointerDown(root, { pointerId: 1, isPrimary: true, button: 0 });
    fireEvent.pointerCancel(root, { pointerId: 1 });
    expect(Harness.calls.end.mock.calls).toEqual([[{ canceled: true }]]);
    fireEvent.pointerDown(root, { pointerId: 2, isPrimary: true, button: 0 });
    fireEvent.lostPointerCapture(root, { pointerId: 2 });
    expect(Harness.calls.start).toHaveBeenCalledTimes(2);
    expect(Harness.calls.end.mock.calls.at(-1)).toEqual([{ canceled: false }]);
  });
});
