import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DataTable } from "@/shared/ui/data/DataTable";
import { notifyResize } from "@/test/resizeObserver";

type Row = { id: string; name: string; score: number };

const rows: Row[] = [{ id: "member-1", name: "いーゆー", score: 100 }];

describe("DataTable", () => {
  it("makes every overflowing table reachable by keyboard and names the scroll region from its caption", async () => {
    const user = userEvent.setup();
    render(
      <DataTable
        caption={{ content: "試合結果" }}
        columns={[{ header: "プレーヤー", key: "name", renderCell: (row) => row.name }]}
        getRowKey={(row) => row.id}
        rows={rows}
      />,
    );
    const table = screen.getByRole("table", { name: "試合結果" });
    const scrollArea = table.parentElement!;
    const scrollWidth = vi.spyOn(scrollArea, "scrollWidth", "get").mockReturnValue(800);
    vi.spyOn(scrollArea, "clientWidth", "get").mockReturnValue(400);
    const scrollHeight = vi.spyOn(scrollArea, "scrollHeight", "get").mockReturnValue(200);
    vi.spyOn(scrollArea, "clientHeight", "get").mockReturnValue(200);

    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    act(() => notifyResize(table));
    const region = screen.getByRole("region", { name: "試合結果" });
    expect(region).toHaveAccessibleDescription("表は左右にスクロールできます。");
    await user.tab();
    expect(region).toHaveFocus();

    scrollHeight.mockReturnValue(600);
    act(() => notifyResize(table));
    expect(region).toHaveAccessibleDescription("表は上下左右にスクロールできます。");

    scrollWidth.mockReturnValue(400);
    act(() => notifyResize(scrollArea));
    expect(region).toHaveAccessibleDescription("表は上下にスクロールできます。");

    scrollHeight.mockReturnValue(200);
    act(() => notifyResize(scrollArea));
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    expect(scrollArea).not.toHaveAttribute("tabindex");
    expect(scrollArea).not.toHaveAttribute("aria-describedby");
  });

  it("keeps the explicit scroll name and prevents sorting while the owning operation is pending", async () => {
    const user = userEvent.setup();
    const onSort = vi.fn();
    render(
      <DataTable
        caption={{ content: "試合結果" }}
        columns={[
          {
            header: "総資産",
            key: "score",
            renderCell: (row) => row.score,
            sortable: true,
            sortDisabled: true,
            onSort,
          },
        ]}
        getRowKey={(row) => row.id}
        rows={rows}
        scrollArea={{ label: "4人の比較" }}
      />,
    );
    expect(screen.getByRole("region", { name: "4人の比較" })).not.toHaveAttribute("tabindex");
    expect(screen.getByRole("columnheader", { name: "総資産" })).not.toHaveAttribute("aria-sort");
    const sort = screen.getByRole("button", { name: "総資産" });
    expect(sort).toBeDisabled();
    await user.click(sort);
    expect(onSort).not.toHaveBeenCalled();
  });

  it("provides a caption, row identity, sort state, and row busy feedback", async () => {
    const user = userEvent.setup();
    const onSort = vi.fn();
    render(
      <DataTable
        caption={{ content: "試合結果" }}
        columns={[
          {
            header: "プレーヤー",
            key: "name",
            renderCell: (row) => row.name,
            rowHeader: true,
          },
          {
            align: "right",
            header: "総資産",
            key: "score",
            renderCell: (row) => row.score,
            sortDirection: "desc",
            sortable: true,
            onSort,
          },
        ]}
        getRowKey={(row) => row.id}
        isRowBusy={() => true}
        rows={rows}
      />,
    );

    expect(screen.getByRole("table", { name: "試合結果" })).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "いーゆー" }).parentElement).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(screen.getByRole("columnheader", { name: "総資産" })).toHaveAttribute(
      "aria-sort",
      "descending",
    );
    expect(screen.getByRole("columnheader", { name: "総資産" })).toHaveAttribute("scope", "col");
    expect(screen.getByRole("cell", { name: "100" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "総資産" }));
    expect(onSort).toHaveBeenCalledTimes(1);
  });
});
