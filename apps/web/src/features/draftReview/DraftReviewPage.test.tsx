import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import { queryClient } from "@/app/queryClient";
import { DraftReviewPage } from "@/features/draftReview/DraftReviewPage";
import {
  createDraftReviewHandoffPayload,
  saveMasterHandoff,
} from "@/features/masters/masterReturnHandoff";

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

    expect(screen.getByRole("button", { name: "確定前チェックへ進む" })).toBeDisabled();
    expect(screen.getAllByText("開催履歴を選択してください").length).toBeGreaterThan(0);
  });

  it("keeps held event creation collapsed until requested", async () => {
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

    expect(await screen.findByText("一覧にない開催履歴を追加")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "作成して選択" })).not.toBeVisible();

    await userEvent.click(screen.getByText("一覧にない開催履歴を追加"));
    expect(screen.getByRole("button", { name: "作成して選択" })).toBeVisible();
  });

  it("shows review notices as dismissible top toast", async () => {
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

    await screen.findByText("一覧にない開催履歴を追加");
    await userEvent.click(screen.getByText("一覧にない開催履歴を追加"));
    await userEvent.click(screen.getByRole("button", { name: "作成して選択" }));

    const toast = await screen.findByRole("status");
    expect(toast).toHaveTextContent(/開催履歴/);
    await userEvent.click(within(toast).getByRole("button", { name: "閉じる" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
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
    const matchSetupHeading = screen.getByRole("heading", { name: "記録先と試合条件" });
    const playerResultsHeading = screen.getByRole("heading", {
      name: "4人分の結果を確認・手修正",
    });
    expect(
      matchSetupHeading.compareDocumentPosition(playerResultsHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByText(/この結果をどの開催履歴・作品として保存するか/)).toBeInTheDocument();
    expect(screen.getByText("OCR読み取り状況を確認")).toBeInTheDocument();
    expect(await screen.findByDisplayValue("あかねまみ")).toBeInTheDocument();
    expect(await screen.findByDisplayValue("15420")).toBeInTheDocument();
    expect(screen.getByText(/緑=高信頼OCR/)).toBeInTheDocument();
  });

  it("allows clearing and retyping numeric result cells without prefixing zero", async () => {
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

    await screen.findByText("開発用サンプル下書きで表示中");
    const rankInput = screen.getByLabelText("ぽんた rank");

    await userEvent.clear(rankInput);
    expect(rankInput).toHaveValue("");

    await userEvent.type(rankInput, "03");
    expect(rankInput).toHaveValue("3");
    expect(screen.getByText("手修正")).toBeInTheDocument();
  });

  it("restores form values after returning from master management with handoffId", async () => {
    window.localStorage.setItem("momoresult.devUser", "ponta");

    const handoffId = saveMasterHandoff(
      createDraftReviewHandoffPayload({
        matchSessionId: "session-1",
        returnTo: "/review/session-1?sample=1",
        values: {
          draftIds: {},
          gameTitleId: "gt_momotetsu_2",
          heldEventId: "held-2",
          mapMasterId: "map_east",
          matchNoInEvent: 9,
          ownerMemberId: "member_ponta",
          playedAt: "2026-02-02T02:02:00.000Z",
          players: [
            {
              incidents: {
                cardShop: 3,
                cardStation: 2,
                destination: 1,
                minusStation: 5,
                plusStation: 4,
                suriNoGinji: 6,
              },
              memberId: "member_ponta",
              playOrder: 1,
              rank: 4,
              revenueManYen: 777,
              totalAssetsManYen: 8888,
            },
            {
              incidents: {
                cardShop: 0,
                cardStation: 0,
                destination: 0,
                minusStation: 0,
                plusStation: 0,
                suriNoGinji: 0,
              },
              memberId: "member_akane_mami",
              playOrder: 2,
              rank: 1,
              revenueManYen: 111,
              totalAssetsManYen: 2222,
            },
            {
              incidents: {
                cardShop: 0,
                cardStation: 0,
                destination: 0,
                minusStation: 0,
                plusStation: 0,
                suriNoGinji: 0,
              },
              memberId: "member_otaka",
              playOrder: 3,
              rank: 2,
              revenueManYen: 333,
              totalAssetsManYen: 4444,
            },
            {
              incidents: {
                cardShop: 0,
                cardStation: 0,
                destination: 0,
                minusStation: 0,
                plusStation: 0,
                suriNoGinji: 0,
              },
              memberId: "member_eu",
              playOrder: 4,
              rank: 3,
              revenueManYen: 555,
              totalAssetsManYen: 6666,
            },
          ],
          seasonMasterId: "season_current",
        },
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
