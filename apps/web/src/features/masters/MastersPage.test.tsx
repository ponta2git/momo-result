import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { queryClient } from "@/app/queryClient";
import { MastersPage } from "@/features/masters/MastersPage";

function renderPage() {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/admin/masters"]}>
        <MastersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("MastersPage", () => {
  afterEach(() => {
    queryClient.clear();
  });

  it("renders heading and section labels", async () => {
    window.localStorage.setItem("momoresult.devUser", "ponta");
    renderPage();

    expect(await screen.findByRole("heading", { name: "マスタ管理" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "作品マスタ" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "マップマスタ" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "シーズンマスタ" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "事件簿マスタ（読み取り専用）" }),
    ).toBeInTheDocument();
  });

  it("creates a new game title via API and shows it in the list", async () => {
    window.localStorage.setItem("momoresult.devUser", "ponta");
    renderPage();

    await waitFor(() => expect(screen.getAllByText("桃太郎電鉄2").length).toBeGreaterThan(0));

    const nameInput = screen.getByPlaceholderText("例: 桃太郎電鉄2");
    await userEvent.type(nameInput, "桃太郎電鉄ワールド");
    const addButtons = screen.getAllByRole("button", { name: "追加" });
    await userEvent.click(addButtons[0]!);

    await waitFor(() =>
      expect(screen.getAllByText("桃太郎電鉄ワールド").length).toBeGreaterThan(0),
    );
  });

  it("seeds incident masters with 6 fixed items", async () => {
    window.localStorage.setItem("momoresult.devUser", "ponta");
    renderPage();

    expect(await screen.findByText("目的地")).toBeInTheDocument();
    expect(screen.getByText("プラス駅")).toBeInTheDocument();
    expect(screen.getByText("マイナス駅")).toBeInTheDocument();
    expect(screen.getByText("カード駅")).toBeInTheDocument();
    expect(screen.getByText("カード売り場")).toBeInTheDocument();
    expect(screen.getByText("スリの銀次")).toBeInTheDocument();
  });
});
