import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  it("preserves edited input and focus when motion preferences change", async () => {
    const user = userEvent.setup();
    media = installMatchMediaController(false);
    render(
      <AppMotionProvider>
        <MotionConsumer />
      </AppMotionProvider>,
    );
    const input = screen.getByRole("textbox", { name: "編集中の内容" });
    await user.clear(input);
    await user.type(input, "まだ保存していない内容");
    expect(screen.getByRole("status", { name: "表示の動き" })).toHaveTextContent("補間を表示");

    act(() => media?.setReducedMotion(true));
    expect(screen.getByRole("status", { name: "表示の動き" })).toHaveTextContent("補間を省略");
    expect(screen.getByRole("textbox", { name: "編集中の内容" })).toHaveValue(
      "まだ保存していない内容",
    );
    expect(screen.getByRole("textbox", { name: "編集中の内容" })).toHaveFocus();

    act(() => media?.setReducedMotion(false));
    expect(screen.getByRole("status", { name: "表示の動き" })).toHaveTextContent("補間を表示");
    expect(screen.getByRole("textbox", { name: "編集中の内容" })).toHaveValue(
      "まだ保存していない内容",
    );
    expect(screen.getByRole("textbox", { name: "編集中の内容" })).toHaveFocus();
  });
});
