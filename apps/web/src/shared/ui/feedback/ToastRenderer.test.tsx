import { Toast } from "@base-ui/react/toast";
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ToastRenderer } from "@/shared/ui/feedback/ToastRenderer";

describe("ToastRenderer", () => {
  it("keeps notifications over the display limit out of interaction", async () => {
    const manager = Toast.createToastManager();
    render(
      <Toast.Provider limit={4} toastManager={manager} timeout={100_000}>
        <ToastRenderer />
      </Toast.Provider>,
    );
    await act(async () => {
      for (let index = 0; index < 5; index += 1)
        manager.add({ id: `result-${index}`, title: `結果 ${index}` });
    });
    expect(await screen.findAllByRole("dialog")).toHaveLength(4);
    expect(screen.getAllByRole("button", { name: "通知を閉じる" })).toHaveLength(4);
    expect(screen.queryByRole("dialog", { name: "結果 0" })).not.toBeInTheDocument();
  });
});
