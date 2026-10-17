import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it } from "vitest";

import type { MatchListRefreshResult } from "@/features/matches/list/matchListRefresh";
import type { MatchListSearch } from "@/features/matches/list/matchListTypes";
import { useMatchListLocationState } from "@/features/matches/list/useMatchListLocationState";
import { useMatchListRefresh } from "@/features/matches/list/useMatchListRefresh";
import { createDeferred } from "@/test/deferred";

function RefreshHarness({
  read,
}: {
  read: (origin: MatchListSearch) => Promise<MatchListRefreshResult>;
}) {
  const selection = useMatchListLocationState();
  const refresh = useMatchListRefresh(selection.current, selection.applyRefresh);
  return (
    <>
      <output aria-label="selected sort">{selection.current.sort}</output>
      <output aria-label="refresh failed">{String(refresh.failed)}</output>
      <button
        type="button"
        disabled={refresh.pending}
        onClick={() => void refresh.run(() => read(selection.current))}
      >
        refresh
      </button>
      <button
        type="button"
        onClick={() => selection.change({ kind: "sort", sort: "updated_desc" })}
      >
        change sort
      </button>
    </>
  );
}

describe("manual list refresh completion", () => {
  it.each(["unchanged", "pending sort"] as const)(
    "keeps partial failure with its accepted selection when the selection is %s",
    async (selection) => {
      const refreshGate = createDeferred();
      const navigationGate = createDeferred();
      const user = userEvent.setup();
      const router = createMemoryRouter(
        [
          {
            path: "/matches",
            hydrateFallbackElement: <p>経路を準備中</p>,
            loader: ({ request }) =>
              new URL(request.url).searchParams.get("sort") === "updated_desc"
                ? navigationGate.promise
                : null,
            element: (
              <RefreshHarness
                read={async (origin) => {
                  await refreshGate.promise;
                  return { kind: "refreshed", origin, summaryFailed: true };
                }}
              />
            ),
          },
        ],
        { initialEntries: ["/matches?cursor=opaque-cursor#results"] },
      );
      render(<RouterProvider router={router} />);
      await user.click(await screen.findByRole("button", { name: "refresh" }));

      if (selection === "pending sort") {
        await user.click(screen.getByRole("button", { name: "change sort" }));
        expect(screen.getByLabelText("selected sort")).toHaveTextContent("updated_desc");
        expect(router.state.location.search).toBe("?cursor=opaque-cursor");
      }
      await act(async () => refreshGate.resolve());
      await waitFor(() => expect(screen.getByRole("button", { name: "refresh" })).toBeEnabled());

      if (selection === "pending sort") {
        expect(screen.getByLabelText("refresh failed")).toHaveTextContent("false");
        expect(screen.getByLabelText("selected sort")).toHaveTextContent("updated_desc");
        await act(async () => navigationGate.resolve());
        await waitFor(() => expect(router.state.location.search).toBe("?sort=updated_desc"));
      } else {
        await waitFor(() => expect(router.state.location.search).toBe(""));
        expect(screen.getByLabelText("refresh failed")).toHaveTextContent("true");
      }
      expect(router.state.location.hash).toBe("#results");
    },
  );
});
