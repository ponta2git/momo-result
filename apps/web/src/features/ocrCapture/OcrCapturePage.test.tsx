import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OcrCapturePage } from "@/features/ocrCapture/OcrCapturePage";
import { queryClient } from "@/app/queryClient";
import { server } from "@/shared/api/msw/server";

type OcrJobRequestBody = {
  imageId: string;
  requestedImageType: string;
};

describe("OcrCapturePage", () => {
  afterEach(() => {
    queryClient.clear();
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("reloads protected master selects after selecting a dev user", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <OcrCapturePage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findAllByRole("option", { name: "ログイン後に読み込みます" })).toHaveLength(
      3,
    );
    expect(screen.getByLabelText("作品")).toBeDisabled();

    await userEvent.selectOptions(screen.getByLabelText("Dev User"), "member_ponta");

    await waitFor(() => expect(screen.getByLabelText("作品")).toBeEnabled());
    expect(screen.getByRole("option", { name: "桃太郎電鉄2" })).toBeInTheDocument();
  });

  it("uploads an image, creates a job, polls to success, and shows the draft", async () => {
    window.localStorage.setItem("momoresult.devUser", "ponta");

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <OcrCapturePage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const input = await screen.findByLabelText("撮影台の画像をアップロード");
    await userEvent.upload(input, new File(["image"], "assets.png", { type: "image/png" }));
    await userEvent.click(screen.getByRole("button", { name: "OCRにかけて下書き保存" }));

    await waitFor(() => expect(screen.getByText("OCRドラフト JSON を表示")).toBeInTheDocument());
  });

  it("uses the final tray position as the OCR image type hint", async () => {
    window.localStorage.setItem("momoresult.devUser", "ponta");
    const createdJobs: OcrJobRequestBody[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation((value) =>
      value instanceof File ? `blob:${value.name}` : "blob:unknown",
    );
    let uploadCount = 0;

    server.use(
      http.post("/api/uploads/images", async () => {
        uploadCount += 1;
        return HttpResponse.json({
          imageId: `image-${uploadCount}`,
          imagePath: "/tmp/ignored.png",
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

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <OcrCapturePage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const input = await screen.findByLabelText("撮影台の画像をアップロード");
    await userEvent.upload(input, new File(["first"], "first.png", { type: "image/png" }));
    await userEvent.upload(input, new File(["second"], "second.png", { type: "image/png" }));
    await userEvent.click(screen.getAllByRole("button", { name: "次の分類へ" })[0]!);
    expect(screen.getByAltText("総資産プレビュー")).toHaveAttribute("src", "blob:second.png");
    expect(screen.getByAltText("収益プレビュー")).toHaveAttribute("src", "blob:first.png");

    await userEvent.click(screen.getByRole("button", { name: "OCRにかけて下書き保存" }));

    await waitFor(() => expect(createdJobs).toHaveLength(2));
    expect(createdJobs).toEqual([
      {
        imageId: "image-1",
        requestedImageType: "total_assets",
        ocrHints: expect.any(Object),
      },
      { imageId: "image-2", requestedImageType: "revenue", ocrHints: expect.any(Object) },
    ]);
  });

  it("enables review after the queued draft is saved even without a running worker", async () => {
    window.localStorage.setItem("momoresult.devUser", "ponta");
    server.use(
      http.get("/api/ocr-jobs/:jobId", ({ params }) =>
        HttpResponse.json({
          jobId: params.jobId,
          draftId: "draft-queued",
          imageId: "image-1",
          imagePath: "/tmp/ignored.png",
          requestedImageType: "total_assets",
          detectedImageType: null,
          status: "queued",
          attemptCount: 1,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        }),
      ),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <OcrCapturePage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const reviewButton = screen.getByRole("button", { name: "下書きを確認する" });
    expect(reviewButton).toBeDisabled();

    const input = await screen.findByLabelText("撮影台の画像をアップロード");
    await userEvent.upload(input, new File(["image"], "assets.png", { type: "image/png" }));
    await userEvent.click(screen.getByRole("button", { name: "OCRにかけて下書き保存" }));

    await waitFor(() => expect(screen.getByText("OCRドラフト JSON を表示")).toBeInTheDocument());
    expect(reviewButton).toBeEnabled();
  });
});
