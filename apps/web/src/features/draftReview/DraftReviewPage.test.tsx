import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { queryClient } from "@/app/queryClient";
import { DraftReviewPage } from "@/features/draftReview/DraftReviewPage";

describe("DraftReviewPage", () => {
  afterEach(() => {
    queryClient.clear();
  });

  it("loads OCR drafts and blocks confirmation until held event is selected", async () => {
    window.localStorage.setItem("momoresult.devUser", "ponta");

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/review/session-1?totalAssets=draft-1"]}>
          <Routes>
            <Route path="/review/:matchSessionId" element={<DraftReviewPage />} />
            <Route path="/ocr/new" element={<p>取り込みコンソール</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: "OCR下書き確認" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByDisplayValue("あかねまみ")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "確定前チェックへ進む" }));
    expect(screen.getAllByText("開催履歴を選択してください").length).toBeGreaterThan(0);
  });

  it("renders the development sample drafts without OCR worker data", async () => {
    window.localStorage.setItem("momoresult.devUser", "ponta");

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/review/dev-sample?sample=1"]}>
          <Routes>
            <Route path="/review/:matchSessionId" element={<DraftReviewPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("開発用サンプル下書きで表示中")).toBeInTheDocument();
    expect(screen.getByDisplayValue("あかねまみ")).toBeInTheDocument();
    expect(screen.getByDisplayValue("15420")).toBeInTheDocument();
    expect(screen.getByText(/修正推奨/)).toBeInTheDocument();
  });
});
