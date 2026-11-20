import { Toast } from "@base-ui/react/toast";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

    const latest = screen.getByRole("dialog", { name: "結果 4" });
    act(() => within(latest).getByRole("button", { name: "通知を閉じる" }).focus());
    await userEvent.setup().keyboard("{Enter}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "結果 4" })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("dialog", { name: "結果 3" })).toBeInTheDocument();
  });
});
