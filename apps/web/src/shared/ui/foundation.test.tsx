import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { Button } from "@/shared/ui/actions/Button";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { cn } from "@/shared/ui/cn";
import { PaginationControls } from "@/shared/ui/data/PaginationControls";
import { Dialog, AlertDialog } from "@/shared/ui/feedback/Dialog";
import { Notice } from "@/shared/ui/feedback/Notice";
import { RouteSuspenseFallback } from "@/shared/ui/feedback/RouteSuspenseFallback";
import { NumberField } from "@/shared/ui/forms/NumberField";
import { SegmentedControl } from "@/shared/ui/forms/SegmentedControl";
import { StatusPill } from "@/shared/ui/status/StatusPill";
import { StatusRail } from "@/shared/ui/status/StatusRail";
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

    deferred.resolve();
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
  });

  it("RouteSuspenseFallback can provide the root main landmark", () => {
    render(<RouteSuspenseFallback asMain />);

    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("aria-busy", "true");
    expect(main).toHaveAttribute("id", "main-content");
  });

  it("RouteSuspenseFallback matches workspace page width", () => {
    render(<RouteSuspenseFallback pathname="/matches/new" />);

    expect(screen.getByTestId("route-suspense-fallback")).toHaveClass("max-w-[90rem]");
  });

  it("StatusPill maps internal status to user-facing labels", () => {
    render(
      <>
        <StatusPill status="ocr_running" />
        <StatusPill status="ocr_failed" note="OCR失敗" />
        <StatusPill status="confirmed" />
      </>,
    );

    expect(screen.getByText("処理中")).toBeInTheDocument();
    expect(screen.getByText("確認待ち")).toBeInTheDocument();
    expect(screen.getByText("確定済")).toBeInTheDocument();
    expect(screen.getByText("OCR失敗")).toBeInTheDocument();
  });

  it("StatusRail can fallback to compact pill", () => {
    render(<StatusRail compact status="needs_review" />);

    expect(screen.getByText("確認待ち")).toBeInTheDocument();
    expect(screen.queryByText("処理中", { selector: "div span" })).not.toBeInTheDocument();
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

  it("NumberField uses text input with numeric mode and min-width contract", () => {
    render(<NumberField label="総資産" name="totalAsset" width="money" />);

    const input = screen.getByLabelText("総資産");
    expect(input).toHaveAttribute("type", "text");
    expect(input).toHaveAttribute("inputmode", "numeric");
    expect(input).toHaveClass("min-w-[12ch]");
  });
});
