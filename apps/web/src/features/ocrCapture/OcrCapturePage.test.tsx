import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { OcrCapturePage } from "@/features/ocrCapture/OcrCapturePage";
import type { CreateOcrJobRequest } from "@/shared/api/ocrJobs";
import { DevUserPicker } from "@/shared/auth/DevUserPicker";
import { setDevUser } from "@/test/auth";
import { createDeferred } from "@/test/deferred";
import { installObjectUrlMock } from "@/test/doubles/dom";
import { setupMsw } from "@/test/msw/lifecycle";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";

setupMsw();

type OcrJobRequestBody = CreateOcrJobRequest;

type MatchDraftRequestBody = {
  gameTitleId?: string;
  heldEventId?: string;
  layoutFamily?: string;
  mapMasterId?: string;
  matchNoInEvent?: number;
  ownerMemberId?: string;
  playedAt?: string;
  seasonMasterId?: string;
  status?: string;
};

let queryClient: QueryClient;
let user: ReturnType<typeof userEvent.setup>;

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="current location">{`${location.pathname}${location.search}`}</output>;
}

function renderCaptureRoute(initialEntry = "/ocr/new") {
  const router = createMemoryRouter(
    [
      { element: <OcrCapturePage />, path: "/ocr/new" },
      {
        element: (
          <>
            <LocationProbe />
            <p>matches-page</p>
          </>
        ),
        path: "/matches",
      },
      {
        element: (
          <>
            <LocationProbe />
            <p>held-event-page</p>
          </>
        ),
        path: "/held-events/:heldEventId",
      },
    ],
    { initialEntries: [initialEntry] },
  );
  const view = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...view, router };
}

async function startOcrAllowingPartialTray() {
  await user.click(screen.getByRole("button", { name: /\d件で読み取りを開始/u }));
  expect(
    await screen.findByRole("dialog", { name: "読み取りを開始しますか？" }),
  ).toBeInTheDocument();
  expect(screen.getByText(/件だけで開始します/u)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /\d件で読み取りを開始/u }));
}

describe("OcrCapturePage", () => {
  beforeEach(() => {
    queryClient = createTestQueryClient();
    user = userEvent.setup();
  });

  it("keeps OCR start disabled until an image is selected", async () => {
    setDevUser();
    renderCaptureRoute();

    expect(await screen.findByRole("option", { name: "桃太郎電鉄2" })).toBeInTheDocument();
    const pageFrame = screen.getByRole("heading", { name: "OCR取り込み" }).closest(".mx-auto");
    expect(pageFrame).toHaveClass("max-w-[96rem]");
    expect(pageFrame).not.toHaveClass("max-w-[120rem]");
    const startButton = screen.getByRole("button", { name: "読み取りを開始" });
    expect(startButton).toBeDisabled();
    expect(startButton).toHaveClass("bg-[var(--color-surface)]");
    expect(screen.getByRole("button", { name: "カメラ開始" })).toHaveClass(
      "bg-[var(--color-action)]",
    );
    expect(
      within(screen.getByRole("combobox", { name: "オーナー" }))
        .getAllByRole("option")
        .map((option) => option.textContent?.trim()),
    ).toEqual(["いーゆー", "ぽんた", "あかねまみ", "おーたか"]);
  });

  it("promotes submission only after all three image types are selected", async () => {
    setDevUser();
    renderCaptureRoute();

    await screen.findByRole("option", { name: "桃太郎電鉄2" });
    const input = screen.getByLabelText("OCRの画像をアップロード");
    await user.upload(input, new File(["assets"], "assets.png", { type: "image/png" }));
    expect(screen.getByRole("button", { name: "1件で読み取りを開始" })).toHaveClass(
      "bg-[var(--color-surface)]",
    );

    expect(screen.getByLabelText("次の撮影先は収益")).toBeInTheDocument();
    await user.upload(input, new File(["revenue"], "revenue.png", { type: "image/png" }));
    expect(screen.getByRole("button", { name: "2件で読み取りを開始" })).toHaveClass(
      "bg-[var(--color-surface)]",
    );

    expect(screen.getByLabelText("次の撮影先は事件簿")).toBeInTheDocument();
    await user.upload(input, new File(["incident"], "incident.png", { type: "image/png" }));

    expect(screen.getByRole("button", { name: "3件で読み取りを開始" })).toHaveClass(
      "bg-[var(--color-action)]",
    );
    expect(screen.getByRole("button", { name: "カメラ開始" })).toHaveClass(
      "bg-[var(--color-surface)]",
    );
  });

  it("offers an in-place retry when setup choices fail to load", async () => {
    setDevUser();
    let attempts = 0;
    server.use(
      http.get("/api/game-titles", () => {
        attempts += 1;
        return attempts === 1
          ? HttpResponse.json({ detail: "temporarily unavailable" }, { status: 500 })
          : HttpResponse.json({
              items: [
                {
                  createdAt: "2026-01-01T00:00:00.000Z",
                  displayOrder: 1,
                  id: "gt_momotetsu_2",
                  layoutFamily: "momotetsu_2",
                  name: "桃太郎電鉄2",
                },
              ],
            });
      }),
    );

    renderCaptureRoute();

    expect(await screen.findByRole("button", { name: "選択肢を再読み込み" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "選択肢を再読み込み" }));

    expect(await screen.findByRole("option", { name: "桃太郎電鉄2" })).toBeInTheDocument();
    expect(attempts).toBe(2);
  });

  it("offers a contextual way to stop the capture flow", async () => {
    setDevUser();
    renderCaptureRoute("/ocr/new?returnTo=%2Fheld-events%2Fheld-1");

    expect(await screen.findByRole("link", { name: "取り込みをやめる" })).toHaveAttribute(
      "href",
      "/held-events/held-1",
    );
  });

  it("uses the selected tray as the capture target and safely replaces its image", async () => {
    setDevUser();
    const objectUrls = installObjectUrlMock({
      createObjectURL: (value) => (value instanceof File ? `blob:${value.name}` : "blob:unknown"),
    });
    renderCaptureRoute();

    expect(await screen.findByRole("option", { name: "桃太郎電鉄2" })).toBeInTheDocument();
    expect(screen.getByLabelText("次の撮影先は総資産")).toBeInTheDocument();
    const incidentCard = screen.getByRole("heading", { name: "事件簿" }).closest("section");
    expect(incidentCard).not.toBeNull();

    await user.click(within(incidentCard!).getByRole("button", { name: "撮影先にする" }));
    expect(screen.getByLabelText("次の撮影先は事件簿")).toBeInTheDocument();

    const input = screen.getByLabelText("OCRの画像をアップロード");
    await user.upload(input, new File(["first"], "incident-first.png", { type: "image/png" }));
    expect(screen.getByAltText("事件簿プレビュー")).toHaveAttribute(
      "src",
      "blob:incident-first.png",
    );
    expect(screen.queryByAltText("総資産プレビュー")).not.toBeInTheDocument();

    await user.click(within(incidentCard!).getByRole("button", { name: "撮り直し先にする" }));
    await user.upload(input, new File(["second"], "incident-second.png", { type: "image/png" }));

    expect(screen.getByAltText("事件簿プレビュー")).toHaveAttribute(
      "src",
      "blob:incident-second.png",
    );
    expect(objectUrls.revokeObjectURL).toHaveBeenCalledWith("blob:incident-first.png");
  });

  it("keeps the mobile reading order from setup through capture, trays, and start", async () => {
    setDevUser();
    renderCaptureRoute();

    await screen.findByRole("option", { name: "桃太郎電鉄2" });
    const headings = ["記録先", "画面を撮影", "分類トレイ", "読み取りの準備"].map((name) =>
      screen.getByRole("heading", { name }),
    );

    for (let index = 0; index < headings.length - 1; index += 1) {
      expect(
        headings[index]!.compareDocumentPosition(headings[index + 1]!) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

  it("asks for confirmation before clearing every selected image", async () => {
    setDevUser();
    renderCaptureRoute();

    await screen.findByRole("option", { name: "桃太郎電鉄2" });
    await user.upload(
      screen.getByLabelText("OCRの画像をアップロード"),
      new File(["image"], "assets.png", { type: "image/png" }),
    );

    await user.click(screen.getByRole("button", { name: "すべて削除" }));
    expect(
      await screen.findByRole("alertdialog", { name: "選択画像をすべて削除しますか？" }),
    ).toBeInTheDocument();
    expect(screen.getByAltText("総資産プレビュー")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "1件を削除" }));
    expect(screen.queryByAltText("総資産プレビュー")).not.toBeInTheDocument();
  });

  it("blocks OCR start while dependent setup choices are still loading", async () => {
    setDevUser();
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
    expect(screen.getByRole("button", { name: "1件で読み取りを開始" })).toBeDisabled();

    setupGate.resolve();
    expect(await screen.findByRole("option", { name: "今シーズン" })).toBeInTheDocument();
    expect(await screen.findByRole("option", { name: "東日本編" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText("試合設定の選択肢を確認しています。")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "1件で読み取りを開始" })).toBeEnabled();
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

    const router = createMemoryRouter([
      {
        element: (
          <>
            <DevUserPicker />
            <OcrCapturePage />
          </>
        ),
        path: "/",
      },
    ]);
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    expect(await screen.findAllByRole("option", { name: "ログイン後に読み込みます" })).toHaveLength(
      4,
    );
    expect(screen.getByLabelText(/作品/u)).toBeDisabled();
    expect(authRequests).toBe(0);

    await user.selectOptions(await screen.findByLabelText("操作用アカウント"), "account_ponta");

    expect(await screen.findByLabelText(/作品/u)).toBeEnabled();
    expect(screen.getByRole("option", { name: "桃太郎電鉄2" })).toBeInTheDocument();
    expect(authRequests).toBe(1);
  });

  it("creates a match draft, starts OCR jobs, and returns to matches", async () => {
    setDevUser();
    const createdDrafts: MatchDraftRequestBody[] = [];
    const createdJobs: OcrJobRequestBody[] = [];
    const intakeKeys: Array<{ endpoint: "job" | "upload"; key: string | null }> = [];

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
      http.post("/api/uploads/images", ({ request }) => {
        intakeKeys.push({ endpoint: "upload", key: request.headers.get("Idempotency-Key") });
        return HttpResponse.json({ imageId: "image-1", mediaType: "image/png", sizeBytes: 5 });
      }),
      http.post("/api/ocr-jobs", async ({ request }) => {
        intakeKeys.push({ endpoint: "job", key: request.headers.get("Idempotency-Key") });
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
    expect(intakeKeys).toHaveLength(2);
    expect(intakeKeys[0]).toEqual({ endpoint: "upload", key: expect.any(String) });
    expect(intakeKeys[1]).toEqual({ endpoint: "job", key: intakeKeys[0]?.key });
  });

  it("inherits held-event context and returns to that event after starting OCR", async () => {
    setDevUser();
    const createdDrafts: MatchDraftRequestBody[] = [];
    server.use(
      http.get("/api/held-events", () =>
        HttpResponse.json({
          items: [
            {
              draftCount: 0,
              heldAt: "2026-03-03T04:05:06.000Z",
              id: "held-latest",
              matchCount: 1,
              nextMatchNo: 2,
            },
          ],
        }),
      ),
      http.get("/api/held-events/:heldEventId", ({ params }) =>
        HttpResponse.json({
          draftCount: 1,
          drafts: [],
          heldAt: "2026-02-03T04:05:06.000Z",
          id: String(params["heldEventId"]),
          matchCount: 3,
          matches: [],
          nextMatchNo: 7,
        }),
      ),
      http.post("/api/match-drafts", async ({ request }) => {
        createdDrafts.push((await request.json()) as MatchDraftRequestBody);
        return HttpResponse.json({
          createdAt: "2026-02-03T04:05:06.000Z",
          matchDraftId: "draft-held-scoped",
          status: "ocr_running",
          updatedAt: "2026-02-03T04:05:06.000Z",
        });
      }),
    );

    renderCaptureRoute("/ocr/new?heldEventId=%20held-scoped%20");

    expect(await screen.findByRole("option", { name: /確定3・未完了1/u })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByLabelText(/開催（任意）/u)).toHaveValue("held-scoped");
      expect(screen.getByLabelText("試合番号")).toHaveValue(7);
    });
    await user.upload(
      screen.getByLabelText("OCRの画像をアップロード"),
      new File(["image"], "assets.png", { type: "image/png" }),
    );
    await startOcrAllowingPartialTray();

    expect(await screen.findByText("held-event-page")).toBeInTheDocument();
    expect(screen.getByLabelText("current location")).toHaveTextContent("/held-events/held-scoped");
    expect(createdDrafts).toEqual([
      expect.objectContaining({
        heldEventId: "held-scoped",
        matchNoInEvent: 7,
        playedAt: "2026-02-03T04:05:06.000Z",
      }),
    ]);
  });

  it("shows pending feedback immediately and prevents duplicate OCR starts", async () => {
    setDevUser();
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

    const { router } = renderCaptureRoute();

    expect(await screen.findByRole("option", { name: "桃太郎電鉄2" })).toBeInTheDocument();
    const input = await screen.findByLabelText("OCRの画像をアップロード");
    await user.upload(input, new File(["image"], "assets.png", { type: "image/png" }));
    await user.click(screen.getByRole("button", { name: "1件で読み取りを開始" }));
    await user.click(await screen.findByRole("button", { name: "1件で読み取りを開始" }));

    expect(await screen.findByRole("dialog", { name: "画像を送信しています" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ダイアログを閉じる" })).not.toBeInTheDocument();
    expect(createdDraftCount).toBe(1);

    const beforeUnloadEvent = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(beforeUnloadEvent);
    expect(beforeUnloadEvent.defaultPrevented).toBe(true);

    act(() => {
      void router.navigate("/matches");
    });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/ocr/new");
      expect(screen.getByRole("dialog", { name: "画像を送信しています" })).toBeInTheDocument();
    });

    draftGate.resolve();
    expect(await screen.findByText("matches-page")).toBeInTheDocument();
    expect(screen.getByLabelText("current location")).toHaveTextContent(
      "/matches?status=ocr_running&sort=updated_desc",
    );
  });

  it("uses the final tray position as the OCR image type hint", async () => {
    setDevUser();
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
    await user.click(screen.getAllByRole("button", { name: "収益へ移動" })[0]!);
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

  it("keeps a partial submission result visible until the user opens the match list", async () => {
    setDevUser();
    let jobRequestCount = 0;

    server.use(
      http.post("/api/ocr-jobs", async () => {
        jobRequestCount += 1;
        if (jobRequestCount === 2) {
          return HttpResponse.json(
            {
              code: "OCR_JOB_FAILED",
              detail: "worker queue unavailable",
              status: 500,
              title: "OCR job creation failed",
              type: "about:blank",
            },
            { status: 500 },
          );
        }
        return HttpResponse.json({
          draftId: "draft-1",
          jobId: "job-1",
          status: "queued",
        });
      }),
    );

    renderCaptureRoute();

    expect(await screen.findByRole("option", { name: "桃太郎電鉄2" })).toBeInTheDocument();
    const input = await screen.findByLabelText("OCRの画像をアップロード");
    await user.upload(input, new File(["first"], "first.png", { type: "image/png" }));
    await user.upload(input, new File(["second"], "second.png", { type: "image/png" }));
    await startOcrAllowingPartialTray();

    expect(
      await screen.findByRole("dialog", { name: "一部の読み取りを開始しました" }),
    ).toBeInTheDocument();
    expect(screen.getByText("1件を開始・1件は未開始")).toBeInTheDocument();
    expect(screen.queryByText("matches-page")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ダイアログを閉じる" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "試合一覧で確認" }));
    expect(await screen.findByText("matches-page")).toBeInTheDocument();
  });

  it("cancels the created match draft when no OCR job is created", async () => {
    setDevUser();
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
    expect(
      await screen.findByRole("dialog", { name: "読み取りを開始できませんでした" }),
    ).toBeInTheDocument();
  });

  it("does not expose a direct review action for OCR-running drafts", async () => {
    setDevUser();
    renderCaptureRoute();

    const input = await screen.findByLabelText("OCRの画像をアップロード");
    await user.upload(input, new File(["image"], "assets.png", { type: "image/png" }));

    expect(
      screen.queryByRole("button", { name: "読み取り結果を確認する" }),
    ).not.toBeInTheDocument();
  });
});
