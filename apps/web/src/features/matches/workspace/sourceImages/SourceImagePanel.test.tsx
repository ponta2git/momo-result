import { QueryClientProvider } from "@tanstack/react-query";
import { act, render as renderUi, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { StrictMode } from "react";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";

import { SourceImagePanel } from "@/features/matches/workspace/sourceImages/SourceImagePanel";
import { sourceImageBlobKeys } from "@/shared/api/queryKeys";
import { evictDraftSourceImageBlobs } from "@/shared/api/sourceImageQueries";
import { clearPrincipalClientState } from "@/shared/auth/principalClientState";
import { setDevUser } from "@/test/auth";
import { createDeferred } from "@/test/deferred";
import { installAnchorClickMock, installObjectUrlMock } from "@/test/doubles/dom";
import { makeMatchDraftSourceImageResponses } from "@/test/factories";
import { setupMsw } from "@/test/msw/lifecycle";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";

const draftId = "draft-1";
const sourceImages = makeMatchDraftSourceImageResponses(draftId);

setupMsw();

function render(ui: ReactElement) {
  const queryClient = createTestQueryClient();
  return {
    ...renderUi(ui, {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    }),
    queryClient,
  };
}

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
  it("announces source-image list loading without presenting a false empty state", () => {
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

  it("uses manually activated tabs with linked tab panels", async () => {
    const user = userEvent.setup();
    render(
      <SourceImagePanel
        loading={false}
        matchDraftId={draftId}
        preferredKind="total_assets"
        sourceImages={[]}
      />,
    );

    const tabList = screen.getByRole("tablist", { name: "元画像の種別" });
    const totalAssetsTab = within(tabList).getByRole("tab", { name: "総資産" });
    const revenueTab = within(tabList).getByRole("tab", { name: "収益" });
    const totalAssetsPanel = screen.getByRole("tabpanel", { name: "総資産" });

    expect(totalAssetsTab).toHaveAttribute("aria-selected", "true");
    expect(totalAssetsTab).toHaveAttribute("aria-controls", totalAssetsPanel.id);
    expect(totalAssetsPanel).toHaveAttribute("aria-labelledby", totalAssetsTab.id);

    await user.click(totalAssetsTab);
    await user.keyboard("{ArrowRight}");

    expect(revenueTab).toHaveFocus();
    expect(revenueTab).toHaveAttribute("aria-selected", "false");
    expect(totalAssetsTab).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{Enter}");

    expect(revenueTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "収益" })).toBeInTheDocument();
  });

  it("replaces the active-image loading status with the available preview", async () => {
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
    setDevUser();
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

  it("loads the displayed image first, prefetches sequentially, and switches without fetching", async () => {
    const user = userEvent.setup();
    const gates = [createDeferred(), createDeferred(), createDeferred()];
    const requestedKinds: string[] = [];
    const objectUrls = installObjectUrlMock({
      createObjectURL: (value) => (value instanceof Blob ? `blob:size-${value.size}` : "blob:0"),
    });
    server.use(
      http.get("/api/match-drafts/:draftId/source-images/:kind", async ({ params }) => {
        const kind = String(params["kind"]);
        const index = sourceImages.findIndex((item) => item.kind === kind);
        requestedKinds.push(kind);
        await gates[index]?.promise;
        return new HttpResponse("x".repeat(index + 1), {
          headers: { "Content-Type": "image/png" },
        });
      }),
    );
    const view = render(
      <SourceImagePanel
        loading={false}
        matchDraftId={draftId}
        preferredKind="total_assets"
        sourceImages={sourceImages}
      />,
    );
    await waitFor(() => expect(requestedKinds).toEqual(["total_assets"]));
    expect(screen.getByLabelText("総資産の元画像を読み込み中")).toBeInTheDocument();
    gates[0]?.resolve();
    expect(await screen.findByRole("img", { name: "総資産の元画像" })).toHaveAttribute(
      "src",
      "blob:size-1",
    );
    await waitFor(() => expect(requestedKinds).toEqual(["total_assets", "revenue"]));
    gates[1]?.resolve();
    await waitFor(() =>
      expect(requestedKinds).toEqual(["total_assets", "revenue", "incident_log"]),
    );
    gates[2]?.resolve();
    await waitFor(() => expect(objectUrls.createObjectURL).toHaveBeenCalledTimes(3));
    for (const [tab, src] of [
      ["収益", "blob:size-2"],
      ["事件簿", "blob:size-3"],
      ["総資産", "blob:size-1"],
    ] as const) {
      await user.click(screen.getByRole("tab", { name: tab }));
      expect(screen.queryByLabelText(`${tab}の元画像を読み込み中`)).not.toBeInTheDocument();
      expect(screen.getByRole("img", { name: `${tab}の元画像` })).toHaveAttribute("src", src);
    }
    expect(requestedKinds).toEqual(["total_assets", "revenue", "incident_log"]);
    const blobs = view.queryClient.getQueriesData<Blob>({
      queryKey: sourceImageBlobKeys.draft(draftId),
    });
    expect(blobs.map(([, blob]) => blob?.size)).toEqual([1, 2, 3]);
    view.unmount();
    expect(
      view.queryClient.getQueriesData({ queryKey: sourceImageBlobKeys.draft(draftId) }),
    ).toEqual([]);
    expect(objectUrls.revokeObjectURL).toHaveBeenCalledTimes(3);
  });

  it("aborts an obsolete active-image request when another tab is selected", async () => {
    const user = userEvent.setup();
    const totalAssetsGate = createDeferred();
    const objectUrls = installObjectUrlMock({ createObjectURL: () => "blob:active-image" });
    let totalAssetsSignal: AbortSignal | undefined;
    server.use(
      http.get("/api/match-drafts/:draftId/source-images/:kind", async ({ params, request }) => {
        if (params["kind"] === "total_assets") {
          totalAssetsSignal = request.signal;
          await totalAssetsGate.promise;
        }
        return sourceImageResponse();
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

    await screen.findByLabelText("総資産の元画像を読み込み中");
    await waitFor(() => expect(totalAssetsSignal).toBeDefined());
    await user.click(screen.getByRole("tab", { name: "収益" }));

    expect(await screen.findByRole("img", { name: "収益の元画像" })).toHaveAttribute(
      "src",
      "blob:active-image",
    );
    expect(totalAssetsSignal?.aborted).toBe(true);
    expect(objectUrls.createObjectURL).toHaveBeenCalledTimes(1);

    totalAssetsGate.resolve();
  });

  it("shares a selected prefetch, preempts it for another image, and ignores its late response", async () => {
    const user = userEvent.setup();
    const oldRevenue = createDeferred();
    const requested: string[] = [];
    let revenueSignal: AbortSignal | undefined;
    const urls = installObjectUrlMock({
      createObjectURL: (blob) => `blob:${blob instanceof Blob ? blob.size : 0}`,
    });
    server.use(
      http.get("/api/match-drafts/:draftId/source-images/:kind", async ({ params, request }) => {
        const kind = String(params["kind"]);
        requested.push(kind);
        if (kind === "revenue" && !revenueSignal) {
          revenueSignal = request.signal;
          await oldRevenue.promise;
          return new HttpResponse("obsolete");
        }
        return new HttpResponse(kind);
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
    await waitFor(() => expect(revenueSignal).toBeDefined());
    await user.click(screen.getByRole("tab", { name: "収益" }));
    expect(screen.getByLabelText("収益の元画像を読み込み中")).toBeInTheDocument();
    expect(requested).toEqual(["total_assets", "revenue"]);
    expect(revenueSignal?.aborted).toBe(false);
    await user.click(screen.getByRole("tab", { name: "事件簿" }));
    expect(await screen.findByRole("img", { name: "事件簿の元画像" })).toHaveAttribute(
      "src",
      "blob:12",
    );
    expect(revenueSignal?.aborted).toBe(true);
    await user.click(screen.getByRole("tab", { name: "収益" }));
    expect(await screen.findByRole("img", { name: "収益の元画像" })).toHaveAttribute(
      "src",
      "blob:7",
    );
    await act(async () => oldRevenue.resolve());
    expect(screen.getByRole("img", { name: "収益の元画像" })).toHaveAttribute("src", "blob:7");
    expect(requested).toEqual(["total_assets", "revenue", "incident_log", "revenue"]);
    expect(urls.createObjectURL).toHaveBeenCalledTimes(3);
  });

  it("keeps background errors local and recovers through selection and manual retry", async () => {
    const user = userEvent.setup();
    installObjectUrlMock();
    let revenueRequests = 0;
    server.use(
      http.get("/api/match-drafts/:draftId/source-images/:kind", ({ params }) => {
        if (params["kind"] === "revenue" && ++revenueRequests < 3)
          return new HttpResponse(null, { status: 503 });
        return sourceImageResponse();
      }),
    );
    const view = render(
      <SourceImagePanel
        loading={false}
        matchDraftId={draftId}
        preferredKind="total_assets"
        sourceImages={sourceImages}
      />,
    );
    await screen.findByRole("img", { name: "総資産の元画像" });
    await waitFor(() =>
      expect(
        view.queryClient
          .getQueryCache()
          .findAll({ queryKey: sourceImageBlobKeys.draft(draftId) })
          .filter((query) => query.state.status === "success"),
      ).toHaveLength(2),
    );
    expect(revenueRequests).toBe(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "収益" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("元画像を読み込めませんでした。");
    expect(revenueRequests).toBe(2);
    await user.click(screen.getByRole("button", { name: "元画像を再読み込み" }));
    expect(await screen.findByRole("img", { name: "収益の元画像" })).toBeInTheDocument();
    expect(revenueRequests).toBe(3);
  });

  it.each([401, 403, 429])("stops remaining prefetches on HTTP %s", async (status) => {
    installObjectUrlMock();
    const requested: string[] = [];
    server.use(
      http.get("/api/match-drafts/:draftId/source-images/:kind", ({ params }) => {
        const kind = String(params["kind"]);
        requested.push(kind);
        return kind === "revenue" ? new HttpResponse(null, { status }) : sourceImageResponse();
      }),
    );
    const view = render(
      <SourceImagePanel
        loading={false}
        matchDraftId={draftId}
        preferredKind="total_assets"
        sourceImages={sourceImages}
      />,
    );
    await screen.findByRole("img", { name: "総資産の元画像" });
    await waitFor(() =>
      expect(
        view.queryClient
          .getQueryCache()
          .findAll({ queryKey: sourceImageBlobKeys.draft(draftId) })
          .some((query) => query.state.status === "error"),
      ).toBe(true),
    );
    expect(requested).toEqual(["total_assets", "revenue"]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each(["terminal", "principal"] as const)(
    "disposes images and prevents further requests when the %s boundary clears Query",
    async (boundary) => {
      const delayed = createDeferred();
      const urls = installObjectUrlMock();
      const requested: string[] = [];
      let backgroundSignal: AbortSignal | undefined;
      server.use(
        http.get("/api/match-drafts/:draftId/source-images/:kind", async ({ params, request }) => {
          const kind = String(params["kind"]);
          requested.push(kind);
          if (kind === "revenue") {
            backgroundSignal = request.signal;
            await delayed.promise;
          }
          return sourceImageResponse();
        }),
      );
      const ui = (
        <SourceImagePanel
          loading={false}
          matchDraftId={draftId}
          preferredKind="total_assets"
          sourceImages={sourceImages}
        />
      );
      const view = render(ui);
      await screen.findByRole("img", { name: "総資産の元画像" });
      await waitFor(() => expect(backgroundSignal).toBeDefined());
      await act(async () => {
        if (boundary === "terminal") evictDraftSourceImageBlobs(view.queryClient, draftId);
        else await clearPrincipalClientState(view.queryClient);
      });
      view.rerender(ui);
      await act(async () => delayed.resolve());
      expect(backgroundSignal?.aborted).toBe(true);
      expect(screen.queryByRole("img")).not.toBeInTheDocument();
      expect(
        view.queryClient.getQueriesData({ queryKey: sourceImageBlobKeys.draft(draftId) }),
      ).toEqual([]);
      expect(urls.revokeObjectURL).toHaveBeenCalledTimes(1);
      expect(urls.createObjectURL).toHaveBeenCalledTimes(1);
      expect(requested).toEqual(["total_assets", "revenue"]);
    },
  );

  it("replaces the same URL's old descriptor without displaying the previous image", async () => {
    const replacement = createDeferred();
    let requests = 0;
    const urls = installObjectUrlMock({
      createObjectURL: (blob) => `blob:${blob instanceof Blob ? blob.size : 0}`,
    });
    server.use(
      http.get("/api/match-drafts/:draftId/source-images/:kind", async () => {
        requests++;
        if (requests > 1) await replacement.promise;
        return new HttpResponse("x".repeat(requests));
      }),
    );
    const initial = sourceImages.slice(0, 1);
    const view = render(
      <SourceImagePanel
        loading={false}
        matchDraftId={draftId}
        preferredKind="total_assets"
        sourceImages={initial}
      />,
    );
    await screen.findByRole("img", { name: "総資産の元画像" });
    view.rerender(
      <SourceImagePanel
        loading={false}
        matchDraftId={draftId}
        preferredKind="total_assets"
        sourceImages={initial.map((item) =>
          Object.assign({}, item, { createdAt: "2026-09-05T00:00:00Z" }),
        )}
      />,
    );
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(urls.revokeObjectURL).toHaveBeenCalledWith("blob:1");
    replacement.resolve();
    expect(await screen.findByRole("img", { name: "総資産の元画像" })).toHaveAttribute(
      "src",
      "blob:2",
    );
    expect(
      view.queryClient.getQueriesData({ queryKey: sourceImageBlobKeys.draft(draftId) }),
    ).toHaveLength(1);
  });

  it("isolates draft and principal scopes and survives StrictMode effect replay", async () => {
    const urls = installObjectUrlMock({
      createObjectURL: (blob) => `blob:${blob instanceof Blob ? blob.size : 0}`,
    });
    server.use(
      http.get(
        "/api/match-drafts/:draftId/source-images/:kind",
        ({ params }) => new HttpResponse(String(params["draftId"])),
      ),
    );
    const view = render(
      <StrictMode>
        <SourceImagePanel
          accountId="first-account"
          loading={false}
          matchDraftId={draftId}
          preferredKind="total_assets"
          sourceImages={sourceImages.slice(0, 1)}
        />
      </StrictMode>,
    );
    expect(await screen.findByRole("img", { name: "総資産の元画像" })).toHaveAttribute(
      "src",
      "blob:7",
    );
    const nextDraft = "next-draft";
    view.rerender(
      <StrictMode>
        <SourceImagePanel
          accountId="second-account"
          loading={false}
          matchDraftId={nextDraft}
          preferredKind="total_assets"
          sourceImages={makeMatchDraftSourceImageResponses(nextDraft).slice(0, 1)}
        />
      </StrictMode>,
    );
    expect(
      view.queryClient.getQueriesData({ queryKey: sourceImageBlobKeys.draft(draftId) }),
    ).toEqual([]);
    expect(await screen.findByRole("img", { name: "総資産の元画像" })).toHaveAttribute(
      "src",
      "blob:10",
    );
    expect(urls.revokeObjectURL).toHaveBeenCalledWith("blob:7");
    view.unmount();
    expect(
      view.queryClient.getQueriesData({ queryKey: sourceImageBlobKeys.draft(nextDraft) }),
    ).toEqual([]);
    expect(urls.revokeObjectURL).toHaveBeenCalledWith("blob:10");
  });

  it.each([3 * 1024 * 1024, 3 * 1024 * 1024 + 1])(
    "bounds cached source image bytes for a %s-byte response",
    async (size) => {
      const urls = installObjectUrlMock();
      const requested: string[] = [];
      server.use(
        http.get("/api/match-drafts/:draftId/source-images/:kind", ({ params }) => {
          requested.push(String(params["kind"]));
          return new HttpResponse(new Uint8Array(size), {
            headers: { "Content-Type": "image/png" },
          });
        }),
      );
      const view = render(
        <SourceImagePanel
          loading={false}
          matchDraftId={draftId}
          preferredKind="total_assets"
          sourceImages={sourceImages}
        />,
      );
      if (size === 3 * 1024 * 1024) {
        await screen.findByRole("img", { name: "総資産の元画像" });
        await waitFor(() => expect(urls.createObjectURL).toHaveBeenCalledTimes(3));
        const cached = view.queryClient.getQueriesData<Blob>({
          queryKey: sourceImageBlobKeys.draft(draftId),
        });
        expect(cached).toHaveLength(3);
        expect(cached.reduce((sum, [, blob]) => sum + (blob?.size ?? 0), 0)).toBe(9 * 1024 * 1024);
      } else {
        expect(await screen.findByRole("alert")).toHaveTextContent(
          "元画像を読み込めませんでした。",
        );
        await waitFor(() =>
          expect(
            view.queryClient
              .getQueryCache()
              .findAll({ queryKey: sourceImageBlobKeys.draft(draftId) })
              .filter((query) => query.state.status === "error"),
          ).toHaveLength(3),
        );
        expect(
          view.queryClient
            .getQueriesData<Blob>({ queryKey: sourceImageBlobKeys.draft(draftId) })
            .every(([, blob]) => blob === undefined),
        ).toBe(true);
        expect(urls.createObjectURL).not.toHaveBeenCalled();
      }
      expect(requested).toEqual(["total_assets", "revenue", "incident_log"]);
    },
  );

  it("revokes cached object URLs when images disappear and when the panel unmounts", async () => {
    const user = userEvent.setup();
    const objectUrls = installObjectUrlMock({
      createObjectURL: (value) => (value instanceof Blob ? `blob:size-${value.size}` : "blob:0"),
    });
    server.use(
      http.get("/api/match-drafts/:draftId/source-images/:kind", ({ params }) => {
        const body = String(params["kind"]) === "total_assets" ? "a" : "bb";
        return new HttpResponse(body, {
          headers: { "Content-Type": "image/png" },
        });
      }),
    );

    const view = render(
      <SourceImagePanel
        loading={false}
        matchDraftId={draftId}
        preferredKind="total_assets"
        sourceImages={sourceImages}
      />,
    );

    expect(await screen.findByRole("img", { name: "総資産の元画像" })).toHaveAttribute(
      "src",
      "blob:size-1",
    );
    await user.click(screen.getByRole("tab", { name: "収益" }));
    expect(await screen.findByRole("img", { name: "収益の元画像" })).toHaveAttribute(
      "src",
      "blob:size-2",
    );

    view.rerender(
      <SourceImagePanel
        loading={false}
        matchDraftId={draftId}
        preferredKind="total_assets"
        sourceImages={sourceImages.slice(1)}
      />,
    );
    await waitFor(() => expect(objectUrls.revokeObjectURL).toHaveBeenCalledWith("blob:size-1"));

    view.unmount();
    expect(objectUrls.revokeObjectURL).toHaveBeenCalledWith("blob:size-2");
  });

  it("follows the current preferred image until a manual selection is fixed", async () => {
    const user = userEvent.setup();
    installObjectUrlMock({
      createObjectURL: (value) => (value instanceof Blob ? `blob:size-${value.size}` : "blob:0"),
    });
    server.use(
      http.get("/api/match-drafts/:draftId/source-images/:kind", ({ params }) => {
        const kind = String(params["kind"]);
        const body = kind === "total_assets" ? "a" : kind === "revenue" ? "bb" : "ccc";
        return new HttpResponse(body, {
          headers: { "Content-Type": "image/png" },
        });
      }),
    );

    const view = render(
      <SourceImagePanel
        loading={false}
        matchDraftId={draftId}
        preferredKind="total_assets"
        sourceImages={sourceImages}
      />,
    );

    expect(await screen.findByRole("img", { name: "総資産の元画像" })).toBeInTheDocument();
    view.rerender(
      <SourceImagePanel
        loading={false}
        matchDraftId={draftId}
        preferredKind="incident_log"
        sourceImages={sourceImages}
      />,
    );
    expect(await screen.findByRole("img", { name: "事件簿の元画像" })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "収益" }));
    expect(screen.getByRole("button", { name: "固定" })).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByRole("img", { name: "収益の元画像" })).toBeInTheDocument();

    view.rerender(
      <SourceImagePanel
        loading={false}
        matchDraftId={draftId}
        preferredKind="total_assets"
        sourceImages={sourceImages}
      />,
    );
    expect(screen.getByRole("img", { name: "収益の元画像" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "自動追従" }));
    expect(await screen.findByRole("img", { name: "総資産の元画像" })).toBeInTheDocument();
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

    await user.click(screen.getByRole("button", { name: "拡大" }));
    expect(await screen.findAllByRole("dialog", { name: "総資産の拡大表示" })).toHaveLength(1);
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
