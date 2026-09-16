import { Toast } from "@base-ui/react/toast";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ToastRenderer } from "@/shared/ui/feedback/ToastRenderer";

describe("ToastRenderer", () => {
  it("limits accessible notifications and updates the same result without duplicating it", async () => {
    const manager = Toast.createToastManager();
    render(
      <Toast.Provider limit={4} toastManager={manager} timeout={100_000}>
        <ToastRenderer />
      </Toast.Provider>,
    );
    act(() => {
      for (let index = 0; index < 5; index += 1)
        manager.add({ id: `result-${index}`, title: `結果 ${index}` });
    });
    expect(await screen.findAllByRole("dialog")).toHaveLength(4);
    expect(screen.getAllByRole("button", { name: "通知を閉じる" })).toHaveLength(4);
    expect(screen.queryByRole("dialog", { name: "結果 0" })).not.toBeInTheDocument();
    act(() => {
      manager.add({ id: "result-4", title: "保存しました" });
    });
    expect(screen.getAllByRole("dialog", { name: "保存しました" })).toHaveLength(1);
    act(() => {
      manager.add({ id: "another-operation", title: "保存しました" });
    });
    expect(screen.getAllByRole("dialog", { name: "保存しました" })).toHaveLength(2);
  });
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

    await user.click(screen.getByRole("button", { name: "通知を閉じる" }));
    expect(screen.queryByRole("dialog", { name: "保存しました" })).not.toBeInTheDocument();

    act(() => {
      manager.add({ description: "次の通知です。", title: "更新しました" });
    });
    expect(await screen.findByText("更新しました")).toBeInTheDocument();
    expect(screen.getAllByRole("dialog", { name: "更新しました" })).toHaveLength(1);
  });
});
