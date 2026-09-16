import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { showToast } from "@/shared/ui/feedback/Toast";
import { ToastHost } from "@/shared/ui/feedback/ToastHost";

// The first notification must keep the same action through initial preparation and rerenders.
describe("ToastHost", () => {
  it("keeps the first notification and its focused close action until dismissal", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ToastHost />);
    act(() => {
      showToast({ description: "入力内容を保存しました。", title: "保存しました" });
    });
    const notification = screen.getByRole("dialog", { name: "保存しました" });
    const close = screen.getByRole("button", { name: "通知を閉じる" });
    act(() => close.focus());

    // Settle module preparation too: a lazy fallback used to replace this focused element.
    await act(async () => {
      await import("@/shared/ui/feedback/ToastRenderer");
    });
    rerender(<ToastHost />);

    expect(screen.getByRole("region", { name: "通知" })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "保存しました" })).toBe(notification);
    expect(screen.getByText("入力内容を保存しました。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "通知を閉じる" })).toBe(close);
    expect(close).toHaveFocus();
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "保存しました" })).not.toBeInTheDocument(),
    );
  });
});
