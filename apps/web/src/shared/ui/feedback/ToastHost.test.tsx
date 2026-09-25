import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { showToast } from "@/shared/ui/feedback/Toast";
import { ToastHost } from "@/shared/ui/feedback/ToastHost";
import { AppMotionProvider } from "@/shared/ui/motion/AppMotionProvider";

// The first notification must keep the same action through initial preparation and rerenders.
describe("ToastHost", () => {
  it("pauses expiry while being read and removes both content and its exit space afterward", async () => {
    vi.useFakeTimers();
    render(
      <AppMotionProvider>
        <ToastHost />
      </AppMotionProvider>,
    );
    await act(async () => {
      showToast({ title: "保存しました", timeout: 1000 });
      await vi.advanceTimersByTimeAsync(200);
    });
    const viewport = screen.getByRole("region", { name: "通知" });
    expect(screen.getByRole("dialog", { name: "保存しました" })).toBeInTheDocument();

    fireEvent.mouseEnter(viewport);
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(screen.getByRole("dialog", { name: "保存しました" })).toBeInTheDocument();

    fireEvent.mouseLeave(viewport);
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(screen.queryByRole("dialog", { name: "保存しました" })).not.toBeInTheDocument();
    await act(async () => vi.advanceTimersByTimeAsync(200));
    expect(screen.queryByText("保存しました")).not.toBeInTheDocument();
    expect(viewport).toBeEmptyDOMElement();
  });

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
