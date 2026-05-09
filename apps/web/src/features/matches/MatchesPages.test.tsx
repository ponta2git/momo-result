import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { MatchDetailPage } from "@/features/matches/MatchDetailPage";
import { MatchesListPage } from "@/features/matches/MatchesListPage";
import { createTestQueryClient } from "@/test/queryClient";

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="current location">{location.search}</output>;
}

describe("MatchesListPage", () => {
  let queryClient: QueryClient;
  beforeEach(() => {
    queryClient = createTestQueryClient();
  });

  it("renders matches and links to detail", async () => {
    window.localStorage.setItem("momoresult.devUser", "account_ponta");

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
    const detailLinks = await screen.findAllByRole("link", { name: "詳細を見る" });
    expect(detailLinks.length).toBeGreaterThan(0);
    detailLinks.forEach((link) => expect(link).toHaveAttribute("href", "/matches/match-1"));
  });

  it("preserves selected held-event filter in URL after submitting", async () => {
    window.localStorage.setItem("momoresult.devUser", "account_ponta");

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/matches"]}>
          <Routes>
            <Route
              path="/matches"
              element={
                <>
                  <LocationProbe />
                  <MatchesListPage />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: "試合" })).toBeInTheDocument();
    const heldEventSelect = screen.getAllByLabelText("開催")[0] as HTMLSelectElement;
    await waitFor(() => expect(heldEventSelect.options.length).toBeGreaterThan(1));

    await userEvent.selectOptions(heldEventSelect, "held-1");
    await userEvent.click(screen.getByRole("button", { name: "絞り込む" }));

    await waitFor(() =>
      expect(screen.getByLabelText("current location")).toHaveTextContent("heldEventId=held-1"),
    );
  });

  it("applies sort changes to the URL search params", async () => {
    window.localStorage.setItem("momoresult.devUser", "account_ponta");

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/matches"]}>
          <Routes>
            <Route
              path="/matches"
              element={
                <>
                  <LocationProbe />
                  <MatchesListPage />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: "試合" })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("ソート"), "updated_desc");
    await userEvent.click(screen.getByRole("button", { name: "絞り込む" }));

    await waitFor(() =>
      expect(screen.getByLabelText("current location")).toHaveTextContent("sort=updated_desc"),
    );
  });
});

describe("MatchDetailPage", () => {
  let queryClient: QueryClient;
  beforeEach(() => {
    queryClient = createTestQueryClient();
  });

  it("shows delete confirmation modal when 削除 clicked", async () => {
    window.localStorage.setItem("momoresult.devUser", "account_ponta");

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

    expect(await screen.findByRole("heading", { name: /試合詳細/ })).toBeInTheDocument();

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
