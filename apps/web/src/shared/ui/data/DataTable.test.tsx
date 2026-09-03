import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DataTable } from "@/shared/ui/data/DataTable";

type Row = { id: string; name: string; score: number };

const rows: Row[] = [{ id: "member-1", name: "いーゆー", score: 100 }];

describe("DataTable", () => {
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

    const staticHeader = screen.getByRole("columnheader", { name: "プレーヤー" });
    const sortableHeader = screen.getByRole("columnheader", { name: "総資産" });
    const sortButton = screen.getByRole("button", { name: "総資産" });
    expect(staticHeader).toHaveClass("px-3", "py-2");
    expect(sortableHeader).toHaveClass("p-0");
    expect(sortableHeader).not.toHaveClass("px-3");
    expect(sortableHeader).not.toHaveClass("py-2");
    expect(sortButton).toHaveClass(
      "w-full",
      "px-3",
      "py-2",
      "justify-end",
      "min-h-11",
      "focus-visible:-outline-offset-3",
      "pointer-fine:min-h-9",
    );

    await user.click(sortButton);
    expect(onSort).toHaveBeenCalledTimes(1);
  });

  it("keeps an empty state inside the table structure", () => {
    render(
      <DataTable<Row>
        caption={{ content: "管理者一覧", visibility: "visible" }}
        columns={[{ header: "名前", key: "name", renderCell: (row) => row.name }]}
        emptyState={<p>対象はありません</p>}
        getRowKey={(row) => row.id}
        rows={[]}
      />,
    );

    expect(screen.getByText("管理者一覧")).toBeVisible();
    expect(screen.getByText("対象はありません").closest("td")).toHaveAttribute("colspan", "1");
  });
});
