import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PaginationControls } from "@/shared/ui/data/PaginationControls";

const middlePage = {
  hasNextPage: true,
  hasPreviousPage: true,
  page: 2,
  pageSize: 25,
  totalItems: 75,
  totalPages: 3,
};

describe("PaginationControls", () => {
  it("provides page-size and boundary navigation in the full variant", async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    const onPageSizeChange = vi.fn();
    render(
      <PaginationControls
        pageSizeOptions={[25, 50]}
        pagination={middlePage}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
      />,
    );

    expect(screen.getByText("26-50件 / 全75件")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "先頭ページへ" }));
    await user.selectOptions(screen.getByLabelText("表示件数"), "50");
    expect(onPageChange).toHaveBeenCalledWith(1);
    expect(onPageSizeChange).toHaveBeenCalledWith(50);
  });

  it("limits the compact variant to previous, current, and next", async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    render(
      <PaginationControls
        ariaLabel="開催候補のページネーション"
        pagination={middlePage}
        variant="compact"
        onPageChange={onPageChange}
      />,
    );

    expect(
      screen.getByRole("navigation", { name: "開催候補のページネーション" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("表示件数")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "先頭ページへ" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "最後のページへ" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "前のページへ" }));
    await user.click(screen.getByRole("button", { name: "次のページへ" }));
    expect(onPageChange).toHaveBeenNthCalledWith(1, 1);
    expect(onPageChange).toHaveBeenNthCalledWith(2, 3);
  });

  it("reports an empty range and disables unavailable navigation", () => {
    render(
      <PaginationControls
        pagination={{
          hasNextPage: false,
          hasPreviousPage: false,
          page: 1,
          pageSize: 25,
          totalItems: 0,
          totalPages: 0,
        }}
        variant="compact"
        onPageChange={vi.fn()}
      />,
    );

    expect(screen.getByText("0件 / 全0件")).toBeInTheDocument();
    expect(screen.getByText("1 / 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "前のページへ" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "次のページへ" })).toBeDisabled();
  });
});
