import { Toast } from "@base-ui/react/toast";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ToastRenderer } from "@/shared/ui/feedback/ToastRenderer";

describe("ToastRenderer", () => {
  it("removes a closed toast from interaction before rendering the next toast", async () => {
    const user = userEvent.setup();
    const manager = Toast.createToastManager();
    render(
      <Toast.Provider toastManager={manager} timeout={100_000}>
        <ToastRenderer />
      </Toast.Provider>,
    );

    act(() => {
      manager.add({ description: "最初の通知です。", title: "保存しました" });
    });
    expect(await screen.findByText("保存しました")).toBeInTheDocument();

    await user.click(screen.getByLabelText("通知を閉じる", { selector: "button" }));
    expect(screen.queryByRole("dialog", { name: "保存しました" })).not.toBeInTheDocument();

    act(() => {
      manager.add({ description: "次の通知です。", title: "更新しました" });
    });
    expect(await screen.findByText("更新しました")).toBeInTheDocument();
    expect(screen.getAllByRole("dialog", { name: "更新しました" })).toHaveLength(1);
  });
});
