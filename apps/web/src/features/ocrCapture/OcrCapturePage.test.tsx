import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import type { CreateOcrJobRequest } from "@/features/ocrCapture/api";
import { OcrCapturePage } from "@/features/ocrCapture/OcrCapturePage";
import { DevUserPicker } from "@/shared/auth/DevUserPicker";
import { createDeferred } from "@/test/deferred";
import { installObjectUrlMock } from "@/test/doubles/dom";
import { setupMsw } from "@/test/msw/lifecycle";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";

setupMsw();

type OcrJobRequestBody = CreateOcrJobRequest;

type MatchDraftRequestBody = {
  gameTitleId?: string;
  layoutFamily?: string;
  mapMasterId?: string;
  ownerMemberId?: string;
  seasonMasterId?: string;
  status?: string;
};

let queryClient: QueryClient;
let user: ReturnType<typeof userEvent.setup>;

function renderCaptureRoute() {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/ocr/new"]}>
        <Routes>
          <Route path="/ocr/new" element={<OcrCapturePage />} />
          <Route path="/matches" element={<p>matches-page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function startOcrAllowingPartialTray() {
  await user.click(screen.getByRole("button", { name: "読み取りを開始して試合一覧へ" }));
  expect(
    await screen.findByText(
      "3種類すべての画像は揃っていません。このまま進める場合は、もう一度開始ボタンを押してください。",
    ),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "このまま読み取りを開始" }));
}

describe("OcrCapturePage", () => {
  beforeEach(() => {
    queryClient = createTestQueryClient();
    user = userEvent.setup();
  });

  it("keeps OCR start disabled until an image is selected", async () => {
    window.localStorage.setItem("momoresult.devUser", "account_ponta");
    renderCaptureRoute();

    expect(await screen.findByRole("option", { name: "桃太郎電鉄2" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "読み取りを開始して試合一覧へ" })).toBeDisabled();
  });

  it("blocks OCR start while dependent setup choices are still loading", async () => {
    window.localStorage.setItem("momoresult.devUser", "account_ponta");
    const setupGate = createDeferred();

    server.use(
      http.get("/api/map-masters", async () => {
        await setupGate.promise;
        return HttpResponse.json({
          items: [
            {
              createdAt: "2026-01-01T00:00:00.000Z",
              displayOrder: 1,
              gameTitleId: "gt_momotetsu_2",
              id: "map_east",
              name: "東日本編",
            },
          ],
        });
      }),
      http.get("/api/season-masters", async () => {
        await setupGate.promise;
        return HttpResponse.json({
          items: [
            {
              createdAt: "2026-01-01T00:00:00.000Z",
              displayOrder: 1,
              gameTitleId: "gt_momotetsu_2",
              id: "season_current",
              name: "今シーズン",
            },
          ],
        });
      }),
    );

    renderCaptureRoute();

    expect(await screen.findByRole("option", { name: "桃太郎電鉄2" })).toBeInTheDocument();
    const input = await screen.findByLabelText("OCRの画像をアップロード");
    await user.upload(input, new File(["image"], "assets.png", { type: "image/png" }));

    expect(await screen.findByText("試合設定の選択肢を確認しています。")).toBeInTheDocument();
    expect(screen.getByLabelText(/シーズン/u)).toBeDisabled();
    expect(screen.getByLabelText(/マップ/u)).toBeDisabled();
    expect(screen.getByRole("button", { name: "読み取りを開始して試合一覧へ" })).toBeDisabled();

    setupGate.resolve();
    expect(await screen.findByRole("option", { name: "今シーズン" })).toBeInTheDocument();
    expect(await screen.findByRole("option", { name: "東日本編" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText("試合設定の選択肢を確認しています。")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "読み取りを開始して試合一覧へ" })).toBeEnabled();
    });
  });

  it("reloads protected master selects after selecting a dev user", async () => {
    let authRequests = 0;
    server.use(
      http.get("/api/auth/me", () => {
        authRequests += 1;
        return HttpResponse.json({
          accountId: "account_ponta",
          displayName: "ぽんた",
          isAdmin: true,
          memberId: "member_ponta",
          csrfToken: "csrf-dev",
        });
      }),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <DevUserPicker />
          <OcrCapturePage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findAllByRole("option", { name: "ログイン後に読み込みます" })).toHaveLength(
      3,
    );
    expect(screen.getByLabelText(/作品/u)).toBeDisabled();
    expect(authRequests).toBe(0);

    await user.selectOptions(await screen.findByLabelText("操作用アカウント"), "account_ponta");

    expect(await screen.findByLabelText(/作品/u)).toBeEnabled();
    expect(screen.getByRole("option", { name: "桃太郎電鉄2" })).toBeInTheDocument();
    expect(authRequests).toBe(1);
  });

  it("creates a match draft, starts OCR jobs, and returns to matches", async () => {
    window.localStorage.setItem("momoresult.devUser", "account_ponta");
    const createdDrafts: MatchDraftRequestBody[] = [];
    const createdJobs: OcrJobRequestBody[] = [];

    server.use(
      http.post("/api/match-drafts", async ({ request }) => {
        createdDrafts.push((await request.json()) as MatchDraftRequestBody);
        return HttpResponse.json({
          matchDraftId: "draft-created-1",
          status: "ocr_running",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        });
      }),
      http.post("/api/ocr-jobs", async ({ request }) => {
        const body = (await request.json()) as OcrJobRequestBody;
        createdJobs.push(body);
        return HttpResponse.json({
          jobId: "job-1",
          draftId: "draft-1",
          status: "queued",
        });
      }),
    );

    renderCaptureRoute();

    expect(await screen.findByRole("option", { name: "桃太郎電鉄2" })).toBeInTheDocument();
    const input = await screen.findByLabelText("OCRの画像をアップロード");
    await user.upload(input, new File(["image"], "assets.png", { type: "image/png" }));
    await startOcrAllowingPartialTray();

    expect(await screen.findByText("matches-page")).toBeInTheDocument();
    const localStorageValues = Array.from({ length: window.localStorage.length }, (_, index) => {
      const key = window.localStorage.key(index);
      return key ? `${key}:${window.localStorage.getItem(key)}` : "";
    }).join("\n");
    expect(localStorageValues).not.toContain("image-1");
    expect(localStorageValues).not.toContain("blob:");
    expect(window.sessionStorage.length).toBe(0);
    expect(createdDrafts).toEqual([
      expect.objectContaining({
        gameTitleId: "gt_momotetsu_2",
        layoutFamily: "momotetsu_2",
        mapMasterId: "map_east",
        ownerMemberId: "member_ponta",
        seasonMasterId: "season_current",
        status: "ocr_running",
      }),
    ]);
    expect(createdJobs).toEqual([
      expect.objectContaining({
        imageId: "image-1",
        matchDraftId: "draft-created-1",
        requestedScreenType: "total_assets",
      }),
    ]);
  });

  it("shows pending feedback immediately and prevents duplicate OCR starts", async () => {
    window.localStorage.setItem("momoresult.devUser", "account_ponta");
    const draftGate = createDeferred();
    let createdDraftCount = 0;

    server.use(
      http.post("/api/match-drafts", async () => {
        createdDraftCount += 1;
        await draftGate.promise;
        return HttpResponse.json({
          matchDraftId: "draft-created-1",
          status: "ocr_running",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        });
      }),
    );

    renderCaptureRoute();

    expect(await screen.findByRole("option", { name: "桃太郎電鉄2" })).toBeInTheDocument();
    const input = await screen.findByLabelText("OCRの画像をアップロード");
    await user.upload(input, new File(["image"], "assets.png", { type: "image/png" }));
    await user.click(screen.getByRole("button", { name: "読み取りを開始して試合一覧へ" }));
    await user.click(await screen.findByRole("button", { name: "このまま読み取りを開始" }));

    const pendingButton = await screen.findByRole("button", { name: "読み取り開始中…" });
    expect(pendingButton).toBeDisabled();
    await user.click(pendingButton);
    expect(createdDraftCount).toBe(1);

    draftGate.resolve();
    expect(await screen.findByText("matches-page")).toBeInTheDocument();
  });

  it("uses the final tray position as the OCR image type hint", async () => {
    window.localStorage.setItem("momoresult.devUser", "account_ponta");
    const createdJobs: OcrJobRequestBody[] = [];
    installObjectUrlMock({
      createObjectURL: (value) => (value instanceof File ? `blob:${value.name}` : "blob:unknown"),
    });
    let uploadCount = 0;

    server.use(
      http.post("/api/uploads/images", async () => {
        uploadCount += 1;
        return HttpResponse.json({
          imageId: `image-${uploadCount}`,
          mediaType: "image/png",
          sizeBytes: 100,
        });
      }),
      http.post("/api/ocr-jobs", async ({ request }) => {
        const body = (await request.json()) as OcrJobRequestBody;
        createdJobs.push(body);
        return HttpResponse.json({
          jobId: `job-${createdJobs.length}`,
          draftId: `draft-${createdJobs.length}`,
          status: "queued",
        });
      }),
    );

    renderCaptureRoute();

    expect(await screen.findByRole("option", { name: "桃太郎電鉄2" })).toBeInTheDocument();
    const input = await screen.findByLabelText("OCRの画像をアップロード");
    await user.upload(input, new File(["first"], "first.png", { type: "image/png" }));
    await user.upload(input, new File(["second"], "second.png", { type: "image/png" }));
    await user.click(screen.getAllByRole("button", { name: "次の分類へ" })[0]!);
    expect(screen.getByAltText("総資産プレビュー")).toHaveAttribute("src", "blob:second.png");
    expect(screen.getByAltText("収益プレビュー")).toHaveAttribute("src", "blob:first.png");

    await startOcrAllowingPartialTray();

    await waitFor(() => expect(createdJobs).toHaveLength(2));
    expect(createdJobs).toEqual([
      {
        imageId: "image-1",
        matchDraftId: "draft-created-1",
        requestedScreenType: "total_assets",
        ocrHints: expect.objectContaining({
          gameTitle: "桃太郎電鉄2",
          knownPlayerAliases: expect.arrayContaining([
            expect.objectContaining({ aliases: expect.arrayContaining(["NO11"]) }),
          ]),
          layoutFamily: "momotetsu_2",
        }),
      },
      {
        imageId: "image-2",
        matchDraftId: "draft-created-1",
        requestedScreenType: "revenue",
        ocrHints: expect.objectContaining({
          gameTitle: "桃太郎電鉄2",
          knownPlayerAliases: expect.arrayContaining([
            expect.objectContaining({ aliases: expect.arrayContaining(["NO11"]) }),
          ]),
          layoutFamily: "momotetsu_2",
        }),
      },
    ]);
  });

  it("cancels the created match draft when no OCR job is created", async () => {
    window.localStorage.setItem("momoresult.devUser", "account_ponta");
    const cancelledDraftIds: string[] = [];

    server.use(
      http.post("/api/ocr-jobs", async () =>
        HttpResponse.json(
          {
            type: "about:blank",
            title: "OCR job creation failed",
            status: 500,
            detail: "worker queue unavailable",
            code: "OCR_JOB_FAILED",
          },
          { status: 500 },
        ),
      ),
      http.post("/api/match-drafts/:draftId/cancel", ({ params }) => {
        cancelledDraftIds.push(String(params["draftId"]));
        return HttpResponse.json({
          matchDraftId: params["draftId"],
          status: "cancelled",
        });
      }),
    );

    renderCaptureRoute();

    expect(await screen.findByRole("option", { name: "桃太郎電鉄2" })).toBeInTheDocument();
    const input = await screen.findByLabelText("OCRの画像をアップロード");
    await user.upload(input, new File(["image"], "assets.png", { type: "image/png" }));
    await startOcrAllowingPartialTray();

    await waitFor(() => expect(cancelledDraftIds).toEqual(["draft-created-1"]));
    expect(screen.queryByText("matches-page")).not.toBeInTheDocument();
  });

  it("does not expose a direct review action for OCR-running drafts", async () => {
    window.localStorage.setItem("momoresult.devUser", "account_ponta");
    renderCaptureRoute();

    const input = await screen.findByLabelText("OCRの画像をアップロード");
    await user.upload(input, new File(["image"], "assets.png", { type: "image/png" }));

    expect(
      screen.queryByRole("button", { name: "読み取り結果を確認する" }),
    ).not.toBeInTheDocument();
  });
});
