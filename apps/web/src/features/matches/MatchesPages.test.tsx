import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import { queryClient } from "@/app/queryClient";
import { MatchDetailPage } from "@/features/matches/MatchDetailPage";
import { MatchesListPage } from "@/features/matches/MatchesListPage";

describe("MatchesListPage", () => {
  afterEach(() => queryClient.clear());

  it("renders matches and links to detail", async () => {
    window.localStorage.setItem("momoresult.devUser", "ponta");

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/matches"]}>
          <Routes>
            <Route path="/matches" element={<MatchesListPage />} />
            <Route path="/matches/:matchId" element={<p>detail-page</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: "試合" })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getAllByRole("link", { name: "詳細を見る" }).length).toBeGreaterThan(0),
    );
  });

  it("updates held-event filter without crashing", async () => {
    window.localStorage.setItem("momoresult.devUser", "ponta");

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/matches"]}>
          <Routes>
            <Route path="/matches" element={<MatchesListPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: "試合" })).toBeInTheDocument();
    const heldEventSelect = screen.getAllByLabelText("開催")[0] as HTMLSelectElement;
    await waitFor(() => expect(heldEventSelect.options.length).toBeGreaterThan(1));

    await userEvent.selectOptions(heldEventSelect, "held-1");
    await userEvent.click(screen.getByRole("button", { name: "絞り込む" }));

    expect(screen.getByRole("heading", { name: "試合" })).toBeInTheDocument();
  });
});

describe("MatchDetailPage", () => {
  afterEach(() => queryClient.clear());

  it("shows delete confirmation modal when 削除 clicked", async () => {
    window.localStorage.setItem("momoresult.devUser", "ponta");

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/matches/match-1"]}>
          <Routes>
            <Route path="/matches/:matchId" element={<MatchDetailPage />} />
            <Route path="/matches" element={<p>list</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /試合詳細/ })).toBeInTheDocument(),
    );

    await userEvent.click(screen.getByRole("button", { name: "削除" }));
    expect(screen.getByRole("heading", { name: "試合を削除しますか？" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "削除する" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "試合を削除しますか？" }),
      ).not.toBeInTheDocument(),
    );
  });
});
