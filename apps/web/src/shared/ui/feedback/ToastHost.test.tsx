import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { showToast } from "@/shared/ui/feedback/Toast";
import { ToastHost } from "@/shared/ui/feedback/ToastHost";
import { AppMotionProvider } from "@/shared/ui/motion/AppMotionProvider";

describe("ToastHost", () => {
  it("keeps a notification readable during hover and removes it after expiry", async () => {
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
  });
});
