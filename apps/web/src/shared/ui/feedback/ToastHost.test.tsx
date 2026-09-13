import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { showToast } from "@/shared/ui/feedback/Toast";
import { ToastHost } from "@/shared/ui/feedback/ToastHost";

vi.mock("@/shared/ui/feedback/ToastRenderer", () => {
  throw new Error("toast renderer chunk unavailable");
});

describe("ToastHost", () => {
  it("keeps notifications available when the optional renderer fails to load", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      render(<ToastHost />);
      act(() => {
        showToast({ description: "入力内容は保持されています。", title: "保存できません" });
      });

      expect(await screen.findByRole("region", { name: "Notifications" })).toBeInTheDocument();
      expect(await screen.findByText("保存できません")).toBeInTheDocument();
      expect(screen.getByText("入力内容は保持されています。")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "通知を閉じる" }));
      await waitFor(() =>
        expect(screen.queryByRole("dialog", { name: "保存できません" })).not.toBeInTheDocument(),
      );
    } finally {
      consoleError.mockRestore();
    }
  });
});
