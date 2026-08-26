import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { Button } from "@/shared/ui/actions/Button";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { cn } from "@/shared/ui/cn";
import { Disclosure } from "@/shared/ui/data/Collapsible";
import { MemberSequenceLabel } from "@/shared/ui/data/MemberSequenceLabel";
import { PaginationControls } from "@/shared/ui/data/PaginationControls";
import { Dialog, AlertDialog } from "@/shared/ui/feedback/Dialog";
import { Notice } from "@/shared/ui/feedback/Notice";
import { ToastHost } from "@/shared/ui/feedback/ToastHost";
import { SegmentedControl } from "@/shared/ui/forms/SegmentedControl";
import { SelectField } from "@/shared/ui/forms/SelectField";
import { TextField } from "@/shared/ui/forms/TextField";
import { StaleShield } from "@/shared/ui/motion/StaleShield";
import { createDeferred } from "@/test/deferred";

describe("ui foundation", () => {
  it("cn merges conflicting classes", () => {
    expect(cn("px-2", "px-4", undefined)).toBe("px-4");
  });

  it("Button defaults to type=button", () => {
    render(<Button>保存</Button>);

    expect(screen.getByRole("button", { name: "保存" })).toHaveAttribute("type", "button");
  });

  it("Button shows spinner and pending label", () => {
    render(
      <Button pending pendingLabel="保存中">
        保存
      </Button>,
    );

    const button = screen.getByRole("button", { name: "保存中" });
    expect(button).toBeDisabled();
    expect(button.querySelector("svg")).not.toBeNull();
  });

  it("LinkButton renders a link with button styling without nesting a button", () => {
    render(
      <MemoryRouter>
        <LinkButton to="/matches/new">手入力で作成</LinkButton>
      </MemoryRouter>,
    );

    const link = screen.getByRole("link", { name: "手入力で作成" });
    expect(link).toHaveAttribute("href", "/matches/new");
    expect(link.querySelector("button")).toBeNull();
    expect(screen.queryByRole("button", { name: "手入力で作成" })).not.toBeInTheDocument();
  });

  it("PaginationControls exposes compact icon navigation with callbacks", async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    const onPageSizeChange = vi.fn();

    render(
      <PaginationControls
        pageSizeOptions={[25, 50]}
        pagination={{
          hasNextPage: true,
          hasPreviousPage: true,
          page: 2,
          pageSize: 25,
          totalItems: 75,
          totalPages: 3,
        }}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
      />,
    );

    expect(screen.getByRole("navigation", { name: "ページネーション" })).toBeInTheDocument();
    expect(screen.getByText("26-50件 / 全75件")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "前のページへ" }));
    await user.click(screen.getByRole("button", { name: "次のページへ" }));
    await user.selectOptions(screen.getByLabelText("表示件数"), "50");

    expect(onPageChange).toHaveBeenNthCalledWith(1, 1);
    expect(onPageChange).toHaveBeenNthCalledWith(2, 3);
    expect(onPageSizeChange).toHaveBeenCalledWith(50);
  });

  it("Disclosure uses one accessible trigger contract without layout animation", async () => {
    const user = userEvent.setup();

    render(
      <Disclosure summary="詳細条件">
        <p>追加条件</p>
      </Disclosure>,
    );

    const trigger = screen.getByRole("button", { name: "詳細条件" });
    expect(trigger).toHaveClass("min-h-11");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger.querySelector(".lucide-chevron-down")).not.toBeNull();
    expect(screen.queryByText("追加条件")).not.toBeInTheDocument();

    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("追加条件")).toBeInTheDocument();
  });

  it("Disclosure keeps the expanded panel transparent", () => {
    render(
      <Disclosure defaultOpen presentation="inset" summary="補足">
        <p>補足内容</p>
      </Disclosure>,
    );

    const panel = screen.getByText("補足内容").parentElement;
    expect(panel).toHaveClass("bg-transparent");
    expect(panel).not.toHaveClass("bg-[var(--color-surface-subtle)]");
  });

  it("MemberSequenceLabel can leave identity neutral when play order owns the accent", () => {
    render(
      <MemberSequenceLabel accent={false} memberId="member_ponta">
        ぽんた
      </MemberSequenceLabel>,
    );

    const label = screen.getByText("ぽんた").parentElement;
    expect(label).toHaveAttribute("data-member-accent", "neutral");
    expect(label?.querySelector("[aria-hidden='true']")).toBeNull();
  });

  it("Disclosure applies semantic trigger hierarchy variants", () => {
    const { rerender } = render(
      <Disclosure summary="主要な開示" triggerVariant="anchor">
        <p>主要な内容</p>
      </Disclosure>,
    );

    const anchorTrigger = screen.getByRole("button", { name: "主要な開示" });
    expect(anchorTrigger).toHaveClass("hover:bg-[var(--color-surface-hover)]");
    expect(anchorTrigger).not.toHaveClass("bg-[var(--color-surface-subtle)]");
    expect(anchorTrigger).not.toHaveClass("bg-[var(--color-surface-selected)]");

    rerender(
      <Disclosure summary="補助的な開示" triggerVariant="supporting">
        <p>補助的な内容</p>
      </Disclosure>,
    );

    const supportingTrigger = screen.getByRole("button", { name: "補助的な開示" });
    expect(supportingTrigger).toHaveClass("font-medium");
    expect(supportingTrigger).toHaveClass("text-[var(--color-text-secondary)]");
    expect(supportingTrigger).toHaveClass("hover:bg-[var(--color-surface-hover)]");
    expect(supportingTrigger).not.toHaveClass("hover:bg-transparent");
    expect(supportingTrigger).toHaveClass("disabled:hover:bg-transparent");
  });

  it("danger Notice defaults role=alert", () => {
    render(<Notice tone="danger">失敗</Notice>);

    expect(screen.getByRole("alert")).toHaveTextContent("失敗");
  });

  it("Dialog exposes its title and description to assistive technology", async () => {
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

    await user.click(screen.getByRole("button", { name: "開く" }));

    expect(
      await screen.findByRole("dialog", {
        description: "保存前に内容を確認します。",
        name: "試合を確定",
      }),
    ).toBeInTheDocument();

    const dialog = screen.getByRole("dialog", { name: "試合を確定" });
    expect(dialog).toHaveClass("overflow-hidden");
    expect(dialog.firstElementChild).toHaveClass("overflow-hidden");
    expect(screen.getByText("本文").parentElement).toHaveClass("overflow-y-auto", "px-2");

    await user.click(screen.getByRole("button", { name: "ダイアログを閉じる" }));
    expect(screen.queryByRole("dialog", { name: "試合を確定" })).not.toBeInTheDocument();
  });

  it("keeps transient toasts away from bottom actions", () => {
    render(<ToastHost />);

    const viewport = screen.getByRole("region", { name: "Notifications" });
    expect(viewport).toHaveClass("momo-safe-top", "momo-safe-right");
    expect(viewport).not.toHaveClass("momo-safe-bottom");
  });

  it("Dialog can prevent dismissal while critical work is running", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    render(
      <Dialog
        busy
        open
        dismissible={false}
        title="読み取りを準備しています"
        onOpenChange={onOpenChange}
      >
        <p>このままお待ちください。</p>
      </Dialog>,
    );

    const dialog = await screen.findByRole("dialog", { name: "読み取りを準備しています" });
    expect(dialog.firstElementChild).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByRole("button", { name: "ダイアログを閉じる" })).not.toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "読み取りを準備しています" })).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("Dialog treats busy work as non-dismissible without extra caller flags", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    render(
      <Dialog busy open title="保存しています" onOpenChange={onOpenChange}>
        <p>このままお待ちください。</p>
      </Dialog>,
    );

    expect(screen.queryByRole("button", { name: "ダイアログを閉じる" })).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "保存しています" })).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("AlertDialog exposes its destructive context to assistive technology", async () => {
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

  it("AlertDialog supports controlled display without a hidden trigger", async () => {
    render(
      <AlertDialog
        open
        description="一覧から削除します。"
        title="開催履歴を削除しますか？"
        onConfirm={vi.fn()}
      />,
    );

    expect(
      await screen.findByRole("alertdialog", {
        description: "一覧から削除します。",
        name: "開催履歴を削除しますか？",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "削除確認" })).not.toBeInTheDocument();
  });

  it("AlertDialog applies the same surface customization contract as Dialog", async () => {
    render(
      <AlertDialog
        open
        backdropClassName="test-backdrop"
        popupClassName="test-popup"
        surfaceClassName="test-surface"
        title="表示契約を確認"
        onConfirm={vi.fn()}
      />,
    );

    const dialog = await screen.findByRole("alertdialog", { name: "表示契約を確認" });
    expect(document.querySelector(".test-backdrop")).not.toBeNull();
    expect(dialog).toHaveClass("test-popup");
    expect(dialog.firstElementChild).toHaveClass("test-surface");
  });

  it("AlertDialog shows pending feedback while confirm work is unresolved", async () => {
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
    expect(confirmButton.querySelector("svg")).not.toBeNull();

    await user.keyboard("{Escape}");
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();

    deferred.resolve();
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
  });

  it("AlertDialog keeps failed operations open and exposes a local retryable error", async () => {
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

  it("AlertDialog supports a non-destructive primary action tone", async () => {
    const user = userEvent.setup();

    render(
      <AlertDialog
        tone="primary"
        title="ログインを有効にしますか？"
        trigger={<Button>変更</Button>}
        onConfirm={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "変更" }));
    expect(await screen.findByRole("button", { name: "実行" })).toHaveClass(
      "bg-[var(--color-action)]",
    );
  });

  it("StaleShield removes shielded content from the readable tree", () => {
    render(
      <StaleShield active fallback={<div>読み込み中</div>}>
        <div>表示中の集計値</div>
      </StaleShield>,
    );

    expect(screen.getByText("読み込み中")).toBeInTheDocument();
    expect(screen.queryByText("表示中の集計値")).not.toBeInTheDocument();
  });

  it("StaleShield can preserve cached content while marking it as stale", () => {
    render(
      <StaleShield
        active
        strategy="preserve-inert"
        busyLabel="比較条件を更新中"
        fallback={<div>読み込み中</div>}
      >
        <button type="button">表示中の集計値</button>
      </StaleShield>,
    );

    expect(screen.getByText("表示中の集計値")).toBeInTheDocument();
    expect(screen.queryByText("読み込み中")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("比較条件を更新中");
    expect(screen.getByRole("button", { name: "表示中の集計値" }).parentElement).toHaveAttribute(
      "inert",
    );
  });

  it("SegmentedControl supports keyboard selection", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();

    render(
      <SegmentedControl
        label="出力形式"
        options={[
          { label: "CSV", value: "csv" },
          { label: "TSV", value: "tsv" },
        ]}
        value="csv"
        onValueChange={onValueChange}
      />,
    );

    const second = screen.getByRole("button", { name: "TSV" });
    second.focus();
    await user.keyboard("{Enter}");

    expect(onValueChange).toHaveBeenCalled();
  });

  it("form fields associate labels, help, and errors with mobile-safe controls", () => {
    render(
      <>
        <TextField description="半角数字で入力" error="入力を確認してください" label="試合番号" />
        <SelectField
          error="選択してください"
          label="作品"
          options={[{ label: "未選択", value: "" }]}
        />
      </>,
    );

    const input = screen.getByLabelText("試合番号");
    const select = screen.getByLabelText("作品");
    expect(input).toHaveClass("min-h-11", "text-base", "sm:min-h-10", "sm:text-sm");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby")?.split(" ")).toHaveLength(2);
    expect(select).toHaveAttribute("aria-invalid", "true");
    expect(select.getAttribute("aria-describedby")).toBeTruthy();
    expect(screen.getAllByRole("alert")).toHaveLength(2);
  });

  it("SegmentedControl disables keyboard and pointer changes", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();

    render(
      <SegmentedControl
        disabled
        label="出力形式"
        options={[
          { label: "CSV", value: "csv" },
          { label: "TSV", value: "tsv" },
        ]}
        value="csv"
        onValueChange={onValueChange}
      />,
    );

    const second = screen.getByRole("button", { name: "TSV" });
    expect(second).toBeDisabled();
    await user.click(second);
    second.focus();
    await user.keyboard("{Enter}");

    expect(onValueChange).not.toHaveBeenCalled();
  });
});
