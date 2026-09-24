import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DataTable } from "@/shared/ui/data/DataTable";

type Row = { id: string; name: string; score: number };

const rows: Row[] = [{ id: "member-1", name: "いーゆー", score: 100 }];

describe("DataTable", () => {
  it("emphasizes only the opted-in column without adding selection or interaction semantics", () => {
    const table = (highlighted: boolean) => (
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
            header: "総資産",
            highlighted,
            key: "score",
            renderCell: (row) => row.score,
          },
        ]}
        getRowKey={(row) => row.id}
        rows={[...rows, { id: "member-2", name: "おたか", score: 200 }]}
      />
    );
    const rendered = render(table(true));
    const header = screen.getByRole("columnheader", { name: "総資産" });
    const cells = screen.getAllByRole("cell");
    for (const cell of [header, ...cells]) {
      expect(cell).toHaveAttribute("data-highlighted", "true");
      expect(cell).toHaveClass("outline-2", "-outline-offset-2");
      expect(cell).not.toHaveAttribute("aria-selected");
      expect(cell).not.toHaveAttribute("tabindex");
    }
    expect(header).toHaveAttribute("scope", "col");
    expect(header).not.toHaveAttribute("aria-sort");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    for (const rowHeader of screen.getAllByRole("rowheader")) {
      expect(rowHeader).toHaveAttribute("scope", "row");
      expect(rowHeader).not.toHaveAttribute("data-highlighted");
    }
    expect(screen.getByRole("columnheader", { name: "プレーヤー" })).not.toHaveAttribute(
      "data-highlighted",
    );

    rendered.rerender(table(false));
    for (const cell of [header, ...cells]) {
      expect(cell).not.toHaveAttribute("data-highlighted");
      expect(cell).not.toHaveClass("outline-2");
    }
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
