import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Button } from "@/shared/ui/actions/Button";
import { AlertDialog, Dialog } from "@/shared/ui/feedback/Dialog";
import { createDeferred } from "@/test/deferred";

describe("Dialog", () => {
  it("announces its context, closes, and restores focus", async () => {
    const user = userEvent.setup();
    render(
      <Dialog
        description="保存前に内容を確認します。"
        title="試合を確定"
        trigger={<Button>開く</Button>}
      >
        <p>本文</p>
      </Dialog>,
    );

    const trigger = screen.getByRole("button", { name: "開く" });
    await user.click(trigger);
    expect(
      await screen.findByRole("dialog", {
        description: "保存前に内容を確認します。",
        name: "試合を確定",
      }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "ダイアログを閉じる" }));
    expect(screen.queryByRole("dialog", { name: "試合を確定" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    expect(screen.getAllByRole("dialog", { name: "試合を確定" })).toHaveLength(1);
  });

  it("does not dismiss work that is still running", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <Dialog busy open title="保存しています" onOpenChange={onOpenChange}>
        <p>このままお待ちください。</p>
      </Dialog>,
    );

    const dialog = await screen.findByRole("dialog", { name: "保存しています" });
    expect(dialog.firstElementChild).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByRole("button", { name: "ダイアログを閉じる" })).not.toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(dialog).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});

describe("AlertDialog", () => {
  it("announces destructive context before confirmation", async () => {
    const user = userEvent.setup();
    render(
      <AlertDialog
        description="この操作は取り消せません。"
        title="試合を削除しますか？"
        trigger={<Button>削除</Button>}
        onConfirm={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "削除" }));
    expect(
      await screen.findByRole("alertdialog", {
        description: "この操作は取り消せません。",
        name: "試合を削除しますか？",
      }),
    ).toBeInTheDocument();
  });

  it("prevents duplicate or dismissing actions while confirmation is pending", async () => {
    const user = userEvent.setup();
    const deferred = createDeferred<void>();
    render(
      <AlertDialog
        description="一覧から削除します。"
        title="開催履歴を削除しますか？"
        trigger={<Button>削除</Button>}
        onConfirm={() => deferred.promise}
      />,
    );

    await user.click(screen.getByRole("button", { name: "削除" }));
    await user.click(await screen.findByRole("button", { name: "実行" }));

    const confirmButton = screen.getByRole("button", { name: "実行" });
    expect(confirmButton).toHaveAttribute("aria-busy", "true");
    expect(confirmButton).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();

    deferred.resolve();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("keeps a failed operation local and allows retry", async () => {
    const user = userEvent.setup();
    const onConfirm = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("削除先を確認できませんでした。"))
      .mockResolvedValueOnce();
    render(
      <AlertDialog
        description="一覧から削除します。"
        title="開催履歴を削除しますか？"
        trigger={<Button>削除</Button>}
        onConfirm={onConfirm}
      />,
    );

    await user.click(screen.getByRole("button", { name: "削除" }));
    await user.click(await screen.findByRole("button", { name: "実行" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("削除先を確認できませんでした。");
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "実行" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(onConfirm).toHaveBeenCalledTimes(2);
  });
});
