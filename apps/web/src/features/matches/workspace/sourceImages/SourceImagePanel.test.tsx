import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SourceImagePanel } from "@/features/matches/workspace/sourceImages/SourceImagePanel";
import { fetchCallsOf } from "@/test/doubles/dom";

describe("SourceImagePanel", () => {
  it("loads source images through the API client so dev auth headers are sent", async () => {
    window.localStorage.setItem("momoresult.devUser", "account_ponta");
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:source-image");
    const fetchMock = vi.fn(
      async () =>
        new Response(new Blob(["mock-image"], { type: "image/png" }), {
          headers: { "Content-Type": "image/png" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <SourceImagePanel
        loading={false}
        preferredKind="total_assets"
        sourceImages={[
          {
            contentType: "image/png",
            createdAt: "2026-01-01T00:00:00.000Z",
            imageUrl: "/api/match-drafts/draft-1/source-images/total_assets",
            kind: "total_assets",
          },
        ]}
      />,
    );

    expect(await screen.findByRole("img", { name: "総資産の元画像" })).toHaveAttribute(
      "src",
      "blob:source-image",
    );
    const init = fetchCallsOf(fetchMock)[0]?.[1];
    if (!init) {
      throw new Error("Expected fetch init");
    }
    expect(init.credentials).toBe("include");
    expect((init.headers as Headers).get("X-Dev-User")).toBe("account_ponta");
  });

  it("opens the source image preview in a modal dialog", async () => {
    const user = userEvent.setup();
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:source-image");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(new Blob(["mock-image"], { type: "image/png" }), {
            headers: { "Content-Type": "image/png" },
          }),
      ),
    );

    render(
      <SourceImagePanel
        loading={false}
        preferredKind="total_assets"
        sourceImages={[
          {
            contentType: "image/png",
            createdAt: "2026-01-01T00:00:00.000Z",
            imageUrl: "/api/match-drafts/draft-1/source-images/total_assets",
            kind: "total_assets",
          },
        ]}
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
});
