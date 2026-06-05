import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { SourceImagePanel } from "@/features/matches/workspace/sourceImages/SourceImagePanel";
import { createDeferred } from "@/test/deferred";
import { installAnchorClickMock, installObjectUrlMock } from "@/test/doubles/dom";
import { makeMatchDraftSourceImageResponses } from "@/test/factories";
import { setupMsw } from "@/test/msw/lifecycle";
import { server } from "@/test/msw/server";

const draftId = "draft-1";
const sourceImages = makeMatchDraftSourceImageResponses(draftId);

setupMsw();

function sourceImageResponse(): Response {
  return new HttpResponse("mock-image", {
    headers: { "Content-Type": "image/png" },
  });
}

function archiveResponse(): Response {
  return new HttpResponse("zip", {
    headers: {
      "Content-Disposition": 'attachment; filename="momo-ocr-images-20260518.zip"',
      "Content-Type": "application/zip",
    },
  });
}

describe("SourceImagePanel", () => {
  it("keeps a stable preview frame while the source image list is loading", () => {
    render(
      <SourceImagePanel
        loading
        matchDraftId={draftId}
        preferredKind="total_assets"
        sourceImages={undefined}
      />,
    );

    const loadingFrame = screen.getByLabelText("元画像を取得中");
    expect(loadingFrame).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "元画像を保存" })).toBeDisabled();
    expect(screen.queryByText("保存できる元画像がありません。")).not.toBeInTheDocument();
  });

  it("keeps a stable preview frame while the active source image is loading", async () => {
    installObjectUrlMock({ createObjectURL: () => "blob:source-image" });
    const responseGate = createDeferred<Response>();
    server.use(
      http.get("/api/match-drafts/:draftId/source-images/:kind", async () => responseGate.promise),
    );

    render(
      <SourceImagePanel
        loading={false}
        matchDraftId={draftId}
        preferredKind="total_assets"
        sourceImages={sourceImages.slice(0, 1)}
      />,
    );

    const loadingFrame = await screen.findByLabelText("総資産の元画像を読み込み中");
    expect(loadingFrame).toHaveAttribute("aria-busy", "true");

    responseGate.resolve(sourceImageResponse());
    expect(await screen.findByRole("img", { name: "総資産の元画像" })).toHaveAttribute(
      "src",
      "blob:source-image",
    );
  });

  it("loads source images through the API client so dev auth headers are sent", async () => {
    window.localStorage.setItem("momoresult.devUser", "account_ponta");
    installObjectUrlMock({ createObjectURL: () => "blob:source-image" });
    let capturedRequest: Request | undefined;
    server.use(
      http.get("/api/match-drafts/:draftId/source-images/:kind", ({ request }) => {
        capturedRequest = request;
        return sourceImageResponse();
      }),
    );

    render(
      <SourceImagePanel
        loading={false}
        matchDraftId={draftId}
        preferredKind="total_assets"
        sourceImages={sourceImages.slice(0, 1)}
      />,
    );

    expect(await screen.findByRole("img", { name: "総資産の元画像" })).toHaveAttribute(
      "src",
      "blob:source-image",
    );
    if (!capturedRequest) {
      throw new Error("Expected source image request");
    }
    expect(capturedRequest.credentials).toBe("include");
    expect(capturedRequest.headers.get("X-Momo-Account-Id")).toBe("account_ponta");
  });

  it("opens the source image preview in a modal dialog", async () => {
    const user = userEvent.setup();
    installObjectUrlMock({ createObjectURL: () => "blob:source-image" });

    render(
      <SourceImagePanel
        loading={false}
        matchDraftId={draftId}
        preferredKind="total_assets"
        sourceImages={sourceImages.slice(0, 1)}
      />,
    );

    expect(await screen.findByRole("img", { name: "総資産の元画像" })).toHaveAttribute(
      "src",
      "blob:source-image",
    );

    await user.click(screen.getByRole("button", { name: "拡大" }));

    const dialog = await screen.findByRole("dialog", { name: "総資産の拡大表示" });
    expect(within(dialog).getByRole("img", { name: "総資産の元画像" })).toHaveAttribute(
      "src",
      "blob:source-image",
    );

    await user.click(within(dialog).getByRole("button", { name: "ダイアログを閉じる" }));

    expect(screen.queryByRole("dialog", { name: "総資産の拡大表示" })).not.toBeInTheDocument();
  });

  it("downloads a zip archive immediately when all source images are available", async () => {
    const user = userEvent.setup();
    const anchorClick = installAnchorClickMock();
    installObjectUrlMock({
      createObjectURL: (value) =>
        value instanceof Blob && value.type === "application/zip"
          ? "blob:zip"
          : "blob:source-image",
    });
    let archiveRequested = false;
    server.use(
      http.get("/api/match-drafts/:draftId/source-images.zip", () => {
        archiveRequested = true;
        return archiveResponse();
      }),
    );

    render(
      <SourceImagePanel
        loading={false}
        matchDraftId={draftId}
        preferredKind="total_assets"
        sourceImages={sourceImages}
      />,
    );

    await screen.findByRole("img", { name: "総資産の元画像" });
    await user.click(screen.getByRole("button", { name: "元画像を保存" }));

    await waitFor(() => expect(anchorClick.click).toHaveBeenCalledTimes(1));
    expect(anchorClick.clickedAnchors[0]?.getAttribute("href")).toBe("blob:zip");
    expect(anchorClick.clickedAnchors[0]?.download).toBe("momo-ocr-images-20260518.zip");
    expect(archiveRequested).toBe(true);
  });

  it("asks for confirmation before downloading a partial source image archive", async () => {
    const user = userEvent.setup();
    const anchorClick = installAnchorClickMock();
    installObjectUrlMock({
      createObjectURL: (value) =>
        value instanceof Blob && value.type === "application/zip"
          ? "blob:zip"
          : "blob:source-image",
    });
    let archiveRequestCount = 0;
    server.use(
      http.get("/api/match-drafts/:draftId/source-images.zip", () => {
        archiveRequestCount += 1;
        return archiveResponse();
      }),
    );

    render(
      <SourceImagePanel
        loading={false}
        matchDraftId={draftId}
        preferredKind="total_assets"
        sourceImages={sourceImages.slice(0, 2)}
      />,
    );

    await screen.findByRole("img", { name: "総資産の元画像" });
    await user.click(screen.getByRole("button", { name: "元画像を保存" }));

    const dialog = await screen.findByRole("dialog", {
      name: "元画像がすべてそろっていません",
    });
    expect(within(dialog).getByText(/保存できる元画像は3枚中2枚です/u)).toBeInTheDocument();
    expect(anchorClick.click).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "キャンセル" }));
    expect(
      screen.queryByRole("dialog", { name: "元画像がすべてそろっていません" }),
    ).not.toBeInTheDocument();
    expect(archiveRequestCount).toBe(0);

    await user.click(screen.getByRole("button", { name: "元画像を保存" }));
    const confirmDialog = await screen.findByRole("dialog", {
      name: "元画像がすべてそろっていません",
    });
    await user.click(within(confirmDialog).getByRole("button", { name: "保存する" }));

    await waitFor(() => expect(anchorClick.click).toHaveBeenCalledTimes(1));
    expect(anchorClick.clickedAnchors[0]?.download).toBe("momo-ocr-images-20260518.zip");
    expect(archiveRequestCount).toBe(1);
  });

  it("disables archive downloads when no source images are available", () => {
    render(
      <SourceImagePanel
        loading={false}
        matchDraftId={draftId}
        preferredKind="total_assets"
        sourceImages={[]}
      />,
    );

    expect(screen.getByRole("button", { name: "元画像を保存" })).toBeDisabled();
    expect(screen.getByText("保存できる元画像がありません。")).toBeInTheDocument();
  });

  it("shows a useful message when the archive download fails", async () => {
    const user = userEvent.setup();
    installObjectUrlMock({ createObjectURL: () => "blob:source-image" });
    server.use(
      http.get("/api/match-drafts/:draftId/source-images.zip", () =>
        HttpResponse.json(
          {
            code: "NOT_FOUND",
            detail: "source images were not found",
            status: 404,
            title: "Not Found",
            type: "about:blank",
          },
          { status: 404 },
        ),
      ),
    );

    render(
      <SourceImagePanel
        loading={false}
        matchDraftId={draftId}
        preferredKind="total_assets"
        sourceImages={sourceImages}
      />,
    );

    await screen.findByRole("img", { name: "総資産の元画像" });
    await user.click(screen.getByRole("button", { name: "元画像を保存" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "元画像を保存できませんでした。確定または削除により画像が利用できなくなった可能性があります。必要な場合は画像を再アップロードしてください。",
    );
  });

  it("shows a retry message when archive download is rate-limited", async () => {
    const user = userEvent.setup();
    installObjectUrlMock({ createObjectURL: () => "blob:source-image" });
    server.use(
      http.get("/api/match-drafts/:draftId/source-images.zip", () =>
        HttpResponse.json(
          {
            code: "TOO_MANY_REQUESTS",
            detail: "元画像の取得が短時間に集中しています。少し待ってから再度お試しください。",
            status: 429,
            title: "Too Many Requests",
            type: "about:blank",
          },
          { status: 429 },
        ),
      ),
    );

    render(
      <SourceImagePanel
        loading={false}
        matchDraftId={draftId}
        preferredKind="total_assets"
        sourceImages={sourceImages}
      />,
    );

    await screen.findByRole("img", { name: "総資産の元画像" });
    await user.click(screen.getByRole("button", { name: "元画像を保存" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "元画像の保存が短時間に集中しています。少し待ってから再度お試しください。",
    );
  });
});
