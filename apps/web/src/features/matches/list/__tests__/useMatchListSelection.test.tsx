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
      <button type="button" onClick={() => state.change({ kind: "memo", q: "bonby" })}>
        memo bonby
      </button>
      <button type="button" onClick={() => state.change({ kind: "memo", q: "ginji" })}>
        memo ginji
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
          state.change({ kind: "sort", sort: "held_asc" });
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
          "/matches?gameTitleId=game-1&seasonMasterId=season-1&mapMasterId=map-1&cursor=old&q=bonby",
        ]}
      >
        <LocationStateHarness />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("button", { name: "change title" }));
    expect(JSON.parse(screen.getByLabelText("current search").textContent ?? "{}")).toMatchObject({
      gameTitleId: "game-2",
      mapMasterId: "",
      seasonMasterId: "",
      cursor: "",
      q: "bonby",
    });
    await user.click(screen.getByRole("button", { name: "change consecutive conditions" }));
    await waitFor(() => expect(screen.getByLabelText("settling")).toHaveTextContent("false"));
    expect(JSON.parse(screen.getByLabelText("current search").textContent ?? "{}")).toMatchObject({
      gameTitleId: "game-2",
      seasonMasterId: "season-2",
      cursor: "",
      q: "bonby",
      sort: "held_asc",
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
              new URL(request.url).searchParams.get("q") === "bonby" ? gate.promise : null,
            element: <LocationStateHarness />,
          },
        ],
        { initialEntries: ["/matches"] },
      );
      render(<RouterProvider router={router} />);
      await screen.findByRole("button", { name: "memo bonby" });

      await user.click(screen.getByRole("button", { name: "memo bonby" }));
      expect(screen.getByLabelText("current search")).toHaveTextContent('"q":"bonby"');
      expect(screen.getByLabelText("settling")).toHaveTextContent("true");
      expect(router.state.location.search).toBe("");

      if (completion === "supersede") {
        await user.click(screen.getByRole("button", { name: "memo ginji" }));
        await waitFor(() => expect(screen.getByLabelText("settling")).toHaveTextContent("false"));
        expect(router.state.location.search).toBe("?q=ginji");
      }
      await act(async () => gate.resolve());
      await waitFor(() => expect(screen.getByLabelText("settling")).toHaveTextContent("false"));
      const finalQuery = completion === "commit" ? "bonby" : "ginji";
      expect(screen.getByLabelText("current search")).toHaveTextContent(`"q":"${finalQuery}"`);
      expect(router.state.location.search).toBe(`?q=${finalQuery}`);
    },
  );

  it("parses list conditions and ignores unknown query parameters", () => {
    render(
      <MemoryRouter
        initialEntries={[
          "/matches?status=confirmed&sort=held_asc&pageSize=10&gameTitleId=%20game-1%20&unknown=1",
        ]}
      >
        <LocationStateHarness />
      </MemoryRouter>,
    );

    expect(JSON.parse(screen.getByLabelText("current search").textContent ?? "{}")).toMatchObject({
      gameTitleId: "game-1",
      pageSize: 25,
      sort: "held_asc",
    });
  });

  it("clears conditions and pagination while keeping sort and the fragment", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/matches?q=bonby&sort=held_asc&cursor=opaque#results"]}>
        <LocationStateHarness />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "clear" }));

    await waitFor(() =>
      expect(screen.getByLabelText("location")).toHaveTextContent("/matches?sort=held_asc#results"),
    );
  });

  it("preserves the list fragment when changing filters", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/matches?sort=held_asc#results"]}>
        <LocationStateHarness />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "memo bonby" }));
    await waitFor(() =>
      expect(screen.getByLabelText("location")).toHaveTextContent(
        "/matches?q=bonby&sort=held_asc#results",
      ),
    );
  });
});
