import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { DraftReviewPage } from "@/features/draftReview/DraftReviewPage";
import {
  createDraftReviewHandoffPayload,
  saveMasterHandoff,
} from "@/features/masters/masterReturnHandoff";
import { server } from "@/shared/api/msw/server";
import { makeDraftReviewHandoffValues, makeFourReviewPlayerInputs } from "@/test/factories";
import { createTestQueryClient } from "@/test/queryClient";

describe("DraftReviewPage", () => {
  let queryClient: QueryClient;
  beforeEach(() => {
    queryClient = createTestQueryClient();
  });

  it("loads OCR drafts and opens confirmation after validation passes", async () => {
    window.localStorage.setItem("momoresult.devUser", "account_ponta");

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
    expect(await screen.findByDisplayValue("あかねまみ")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "確定前チェックへ進む" }));
    expect(
      await screen.findByRole("heading", { name: "この内容で確定しますか？" }),
    ).toBeInTheDocument();
  });

  it("keeps held event creation collapsed until requested", async () => {
    window.localStorage.setItem("momoresult.devUser", "account_ponta");

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/review/dev-sample?sample=1"]}>
          <Routes>
            <Route path="/review/:matchSessionId" element={<DraftReviewPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("一覧にない開催履歴を追加")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "作成して選択" })).not.toBeVisible();

    await userEvent.click(screen.getByText("一覧にない開催履歴を追加"));
    expect(screen.getByRole("button", { name: "作成して選択" })).toBeVisible();
  });

  it("shows review notices as dismissible top toast", async () => {
    window.localStorage.setItem("momoresult.devUser", "account_ponta");
    const heldEvents = [{ id: "held-1", heldAt: "2026-01-01T00:00:00.000Z", matchCount: 0 }];
    const createdHeldEvent = {
      id: "held-created",
      heldAt: "2026-01-02T00:00:00.000Z",
      matchCount: 0,
    };
    server.use(
      http.get("/api/held-events", () => HttpResponse.json({ items: heldEvents })),
      http.post("/api/held-events", () => {
        heldEvents.unshift(createdHeldEvent);
        return HttpResponse.json(createdHeldEvent);
      }),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/review/dev-sample?sample=1"]}>
          <Routes>
            <Route path="/review/:matchSessionId" element={<DraftReviewPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await screen.findByText("一覧にない開催履歴を追加");
    await userEvent.click(screen.getByText("一覧にない開催履歴を追加"));
    await userEvent.click(screen.getByRole("button", { name: "作成して選択" }));

    const heldEventSelect = screen.getByLabelText(/開催履歴/u) as HTMLSelectElement;
    await waitFor(() => expect(heldEventSelect).toHaveValue("held-created"));
    expect([...heldEventSelect.options].map((option) => option.value)).toContain("held-created");
    expect((await screen.findAllByText(/開催履歴（/u)).length).toBeGreaterThan(0);
  });

  it("renders the development sample drafts without OCR worker data", async () => {
    window.localStorage.setItem("momoresult.devUser", "account_ponta");

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
    const matchSetupHeading = screen.getByRole("heading", { name: "記録先と試合条件" });
    const playerResultsHeading = screen.getByRole("heading", {
      name: "4人分の結果を確認・手修正",
    });
    expect(
      matchSetupHeading.compareDocumentPosition(playerResultsHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByText(/この結果をどの開催履歴・作品として保存するか/u)).toBeInTheDocument();
    expect(await screen.findByDisplayValue("あかねまみ")).toBeInTheDocument();
    expect(await screen.findByDisplayValue("15420")).toBeInTheDocument();
    expect(screen.queryByText("OCR読み取り状況を確認")).not.toBeInTheDocument();
    expect(screen.queryByText(/緑=高信頼OCR/u)).not.toBeInTheDocument();
    expect(screen.getByText(/事件簿はEnterで横方向に移動します/u)).toBeInTheDocument();
  });

  it("allows clearing and retyping numeric result cells without prefixing zero", async () => {
    window.localStorage.setItem("momoresult.devUser", "account_ponta");

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/review/dev-sample?sample=1"]}>
          <Routes>
            <Route path="/review/:matchSessionId" element={<DraftReviewPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await screen.findByText("開発用サンプル下書きで表示中");
    const rankInput = screen.getByLabelText("ぽんた rank");

    await userEvent.clear(rankInput);
    expect(rankInput).toHaveValue("");

    await userEvent.type(rankInput, "03");
    expect(rankInput).toHaveValue("3");
    expect(screen.getByText("手修正")).toBeInTheDocument();
  });

  it("restores form values after returning from master management with handoffId", async () => {
    window.localStorage.setItem("momoresult.devUser", "account_ponta");

    const handoffId = saveMasterHandoff(
      createDraftReviewHandoffPayload({
        matchSessionId: "session-1",
        returnTo: "/review/session-1?sample=1",
        values: makeDraftReviewHandoffValues({
          heldEventId: "held-2",
          matchNoInEvent: 9,
          playedAt: "2026-02-02T02:02:00.000Z",
          players: makeFourReviewPlayerInputs([
            {
              memberId: "member_ponta",
              rank: 4,
              revenueManYen: 777,
              totalAssetsManYen: 8888,
              incidents: {
                cardShop: 3,
                cardStation: 2,
                destination: 1,
                minusStation: 5,
                plusStation: 4,
                suriNoGinji: 6,
              },
            },
            { memberId: "member_akane_mami", rank: 1, revenueManYen: 111, totalAssetsManYen: 2222 },
            { memberId: "member_otaka", rank: 2, revenueManYen: 333, totalAssetsManYen: 4444 },
            { memberId: "member_eu", rank: 3, revenueManYen: 555, totalAssetsManYen: 6666 },
          ]),
        }),
      }),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/review/session-1?sample=1&handoffId=${handoffId}`]}>
          <Routes>
            <Route path="/review/:matchSessionId" element={<DraftReviewPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(
      (await screen.findAllByText("マスタ管理から戻ったため、入力内容を復元しました。")).length,
    ).toBeGreaterThan(0);
    expect(screen.getByLabelText("試合番号")).toHaveValue("9");
    expect(screen.getByLabelText("ぽんた rank")).toHaveValue("4");
    expect(screen.getByDisplayValue("777")).toBeInTheDocument();
  });
});
