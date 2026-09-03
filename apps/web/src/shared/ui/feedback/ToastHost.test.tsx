import { act, render, screen } from "@testing-library/react";
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

      const viewport = await screen.findByRole("region", { name: "Notifications" });
      expect(viewport).toBeInTheDocument();
      expect(viewport).toHaveClass("momo-toast-viewport", "gap-2");
      expect(viewport).not.toHaveClass("p-2");
      expect(await screen.findByText("保存できません")).toBeInTheDocument();
      expect(screen.getByText("入力内容は保持されています。")).toBeInTheDocument();
    } finally {
      consoleError.mockRestore();
    }
  });
});
