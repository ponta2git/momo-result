import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProgressBar } from "@/shared/ui/feedback/ProgressBar";

describe("ProgressBar", () => {
  it("updates determinate accessibility values", () => {
    const view = render(
      <ProgressBar
        aria-label="画像送信の進捗"
        aria-valuetext="3件中1件の送信処理が完了"
        max={3}
        value={1}
      />,
    );

    const progress = screen.getByRole("progressbar", { name: "画像送信の進捗" });
    expect(progress).toHaveAttribute("aria-valuemin", "0");
    expect(progress).toHaveAttribute("aria-valuemax", "3");
    expect(progress).toHaveAttribute("aria-valuenow", "1");
    expect(progress).toHaveAttribute("aria-valuetext", "3件中1件の送信処理が完了");

    view.rerender(
      <ProgressBar
        aria-label="画像送信の進捗"
        aria-valuetext="3件中3件の送信処理が完了"
        max={3}
        value={3}
      />,
    );
    expect(progress).toHaveAttribute("aria-valuenow", "3");
    expect(progress).toHaveAttribute("aria-valuetext", "3件中3件の送信処理が完了");
  });

  it("clamps invalid values without exposing an invalid progress range", () => {
    render(<ProgressBar aria-label="進捗" max={0} value={10} />);

    const progress = screen.getByRole("progressbar", { name: "進捗" });
    expect(progress).toHaveAttribute("aria-valuemax", "1");
    expect(progress).toHaveAttribute("aria-valuenow", "1");
  });
});
