import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, MemoryRouter, RouterProvider, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { useMatchListLocationState } from "@/features/matches/list/useMatchListLocationState";
import { createDeferred } from "@/test/deferred";

function LocationStateHarness() {
  const state = useMatchListLocationState();
  const location = useLocation();
  return (
    <>
      <output aria-label="settling">{String(state.settling)}</output>
      <button type="button" onClick={() => state.apply({ ...state.current, status: "confirmed" })}>
        confirmed
      </button>
      <button
        type="button"
        onClick={() => state.apply({ ...state.current, status: "needs_review" })}
      >
        needs review
      </button>
      <output aria-label="current search">{JSON.stringify(state.current)}</output>
      <output aria-label="list return path">{state.listReturnTo}</output>
      <output aria-label="location">{`${location.pathname}${location.search}${location.hash}`}</output>
      <button type="button" onClick={state.clear}>
        clear
      </button>
    </>
  );
}

describe("useMatchListLocationState", () => {
  it.each(["commit", "supersede"] as const)(
    "keeps the selected filter consistent when a pending navigation must %s",
    async (completion) => {
      const gate = createDeferred();
      const user = userEvent.setup();
      const router = createMemoryRouter(
        [
          {
            path: "/matches",
            hydrateFallbackElement: <p>経路を準備中</p>,
            loader: ({ request }) =>
              new URL(request.url).searchParams.get("status") === "confirmed" ? gate.promise : null,
            element: <LocationStateHarness />,
          },
        ],
        { initialEntries: ["/matches"] },
      );
      render(<RouterProvider router={router} />);
      await screen.findByRole("button", { name: "confirmed" });

      await user.click(screen.getByRole("button", { name: "confirmed" }));
      expect(screen.getByLabelText("current search")).toHaveTextContent('"status":"confirmed"');
      expect(screen.getByLabelText("settling")).toHaveTextContent("true");
      expect(router.state.location.search).toBe("");

      if (completion === "supersede") {
        await user.click(screen.getByRole("button", { name: "needs review" }));
        await waitFor(() => expect(screen.getByLabelText("settling")).toHaveTextContent("false"));
        expect(router.state.location.search).toBe("?status=needs_review");
      }
      await act(async () => gate.resolve());
      await waitFor(() => expect(screen.getByLabelText("settling")).toHaveTextContent("false"));
      const finalStatus = completion === "commit" ? "confirmed" : "needs_review";
      expect(screen.getByLabelText("current search")).toHaveTextContent(
        `"status":"${finalStatus}"`,
      );
      expect(router.state.location.search).toBe(`?status=${finalStatus}`);
    },
  );

  it("builds a canonical list return path from parsed URL state", () => {
    render(
      <MemoryRouter
        initialEntries={[
          "/matches?status=broken&sort=updated_desc&pageSize=100&gameTitleId=%20game-1%20&unknown=1&returnTo=%2Fheld-events%2Fheld-1",
        ]}
      >
        <LocationStateHarness />
      </MemoryRouter>,
    );

    expect(JSON.parse(screen.getByLabelText("current search").textContent ?? "{}")).toMatchObject({
      gameTitleId: "game-1",
      pageSize: 10,
      sort: "updated_desc",
      status: "all",
    });
    expect(screen.getByLabelText("list return path")).toHaveTextContent(
      "/matches?gameTitleId=game-1&sort=updated_desc&returnTo=%2Fheld-events%2Fheld-1",
    );
  });

  it("clears list state while preserving a safe parent return path", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter
        initialEntries={[
          "/matches?status=confirmed&cursor=opaque&returnTo=%2Fheld-events%2Fheld-1",
        ]}
      >
        <LocationStateHarness />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "clear" }));

    await waitFor(() =>
      expect(screen.getByLabelText("location")).toHaveTextContent(
        "/matches?returnTo=%2Fheld-events%2Fheld-1",
      ),
    );
    expect(screen.getByLabelText("list return path")).toHaveTextContent(
      "/matches?returnTo=%2Fheld-events%2Fheld-1",
    );
  });

  it("preserves the list fragment in detail return paths and filter changes", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/matches?sort=updated_desc#results"]}>
        <LocationStateHarness />
      </MemoryRouter>,
    );

    expect(screen.getByLabelText("list return path")).toHaveTextContent(
      "/matches?sort=updated_desc#results",
    );
    await user.click(screen.getByRole("button", { name: "confirmed" }));
    await waitFor(() =>
      expect(screen.getByLabelText("location")).toHaveTextContent(
        "/matches?status=confirmed&sort=updated_desc#results",
      ),
    );
    expect(screen.getByLabelText("list return path")).toHaveTextContent(
      "/matches?status=confirmed&sort=updated_desc#results",
    );
  });
});
