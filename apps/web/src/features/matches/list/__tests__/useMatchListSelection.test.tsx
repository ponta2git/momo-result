import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, MemoryRouter, RouterProvider, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { useMatchListSelection } from "@/features/matches/list/useMatchListSelection";
import { createDeferred } from "@/test/deferred";

function LocationStateHarness() {
  const state = useMatchListSelection();
  const location = useLocation();
  return (
    <>
      <output aria-label="settling">{String(state.settling)}</output>
      <button type="button" onClick={() => state.change({ kind: "status", status: "confirmed" })}>
        confirmed
      </button>
      <button
        type="button"
        onClick={() => state.change({ kind: "status", status: "needs_review" })}
      >
        needs review
      </button>
      <output aria-label="current search">{JSON.stringify(state.current)}</output>
      <output aria-label="location">{`${location.pathname}${location.search}${location.hash}`}</output>
      <button type="button" onClick={state.clear}>
        clear
      </button>
      <button
        type="button"
        onClick={() => state.change({ kind: "gameTitle", gameTitleId: "game-2" })}
      >
        change title
      </button>
      <button
        type="button"
        onClick={() => {
          state.change({ kind: "gameTitle", gameTitleId: "game-2" });
          state.change({ kind: "season", seasonMasterId: "season-2" });
          state.change({ kind: "sort", sort: "updated_desc" });
        }}
      >
        change consecutive conditions
      </button>
    </>
  );
}

describe("useMatchListSelection", () => {
  it("applies consecutive field intents to the latest selection and resets incompatible paging", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter
        initialEntries={[
          "/matches?gameTitleId=game-1&seasonMasterId=season-1&cursor=old&status=confirmed",
        ]}
      >
        <LocationStateHarness />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("button", { name: "change title" }));
    expect(JSON.parse(screen.getByLabelText("current search").textContent ?? "{}")).toMatchObject({
      gameTitleId: "game-2",
      seasonMasterId: "",
      cursor: "",
      status: "confirmed",
    });
    await user.click(screen.getByRole("button", { name: "change consecutive conditions" }));
    await waitFor(() => expect(screen.getByLabelText("settling")).toHaveTextContent("false"));
    expect(JSON.parse(screen.getByLabelText("current search").textContent ?? "{}")).toMatchObject({
      gameTitleId: "game-2",
      seasonMasterId: "season-2",
      cursor: "",
      status: "confirmed",
      sort: "updated_desc",
    });
  });

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

  it("parses list conditions and ignores unknown query parameters", () => {
    render(
      <MemoryRouter
        initialEntries={[
          "/matches?status=broken&sort=updated_desc&pageSize=100&gameTitleId=%20game-1%20&unknown=1",
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
  });

  it("clears list filters and pagination while retaining the fragment", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/matches?status=confirmed&cursor=opaque#results"]}>
        <LocationStateHarness />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "clear" }));

    await waitFor(() =>
      expect(screen.getByLabelText("location")).toHaveTextContent("/matches#results"),
    );
  });

  it("preserves the list fragment when changing filters", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/matches?sort=updated_desc#results"]}>
        <LocationStateHarness />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "confirmed" }));
    await waitFor(() =>
      expect(screen.getByLabelText("location")).toHaveTextContent(
        "/matches?status=confirmed&sort=updated_desc#results",
      ),
    );
  });
});
