import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SourceImagePanel } from "@/features/matches/workspace/sourceImages/SourceImagePanel";
import { fetchCallsOf } from "@/test/doubles/dom";

describe("SourceImagePanel", () => {
  it("loads source images through the API client so dev auth headers are sent", async () => {
    window.localStorage.setItem("momoresult.devUser", "ponta");
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
    expect((init.headers as Headers).get("X-Dev-User")).toBe("ponta");
  });
});
