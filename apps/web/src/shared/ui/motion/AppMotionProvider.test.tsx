import { act, render, screen } from "@testing-library/react";
import { useReducedMotionConfig } from "motion/react";
import { afterEach, describe, expect, it } from "vitest";

import { AppMotionProvider } from "@/shared/ui/motion/AppMotionProvider";
import { installMatchMediaController } from "@/test/doubles/dom";
import type { MatchMediaController } from "@/test/doubles/dom";

let media: MatchMediaController | undefined;

afterEach(() => {
  media?.restore();
  media = undefined;
});

/** The same Motion policy API that dialog, progress, toast and disclosure consume. */
function MotionConsumer() {
  const reducedMotion = useReducedMotionConfig();
  return (
    <>
      <output aria-label="表示の動き">{reducedMotion ? "補間を省略" : "補間を表示"}</output>
      <input aria-label="編集中の内容" defaultValue="入力を保持" />
    </>
  );
}

describe("AppMotionProvider", () => {
  it("updates mounted consumers when motion preferences change without replacing their task", () => {
    media = installMatchMediaController(false);
    render(
      <AppMotionProvider>
        <MotionConsumer />
      </AppMotionProvider>,
    );
    const input = screen.getByRole("textbox", { name: "編集中の内容" });
    input.focus();
    expect(screen.getByRole("status", { name: "表示の動き" })).toHaveTextContent("補間を表示");

    act(() => media?.setReducedMotion(true));
    expect(screen.getByRole("status", { name: "表示の動き" })).toHaveTextContent("補間を省略");
    expect(screen.getByRole("textbox", { name: "編集中の内容" })).toBe(input);
    expect(input).toHaveValue("入力を保持");
    expect(input).toHaveFocus();

    act(() => media?.setReducedMotion(false));
    expect(screen.getByRole("status", { name: "表示の動き" })).toHaveTextContent("補間を表示");
    expect(input).toHaveFocus();
  });
});
