import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider, useLocation, useNavigate } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { useConfirmedDraftNavigationCommand } from "@/features/matches/list/useConfirmedDraftNavigationCommand";
import { setDevUser } from "@/test/auth";
import { createDeferred } from "@/test/deferred";
import { makeMatchDraftReviewResponse } from "@/test/factories/matchDraftReview";
import { setupMsw } from "@/test/msw/lifecycle";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";

setupMsw();

function CommandHarness({ onRun }: { onRun: (completion: Promise<void>) => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const command = useConfirmedDraftNavigationCommand(`/matches${location.search}`);
  return (
    <>
      {["draft-a", "draft-b"].map((draftId) => (
        <div key={draftId}>
          <button
            disabled={command.checkingIds.has(draftId)}
            type="button"
            onClick={() =>
              onRun(
                command.run({
                  draftStatusCheck: { draftId },
                  href: `/review/${draftId}`,
                  label: draftId,
                }),
              )
            }
          >
            {draftId}
          </button>
          {command.errors[draftId] ? <p role="alert">{command.errors[draftId]}</p> : null}
        </div>
      ))}
      <button type="button" onClick={() => navigate("/other")}>
        leave
      </button>
      <button type="button" onClick={() => navigate("?status=confirmed")}>
        change filter
      </button>
    </>
  );
}

function renderCommand() {
  const queryClient = createTestQueryClient();
  const commands: Array<Promise<void>> = [];
  const router = createMemoryRouter(
    [
      {
        path: "/matches",
        element: <CommandHarness onRun={(completion) => commands.push(completion)} />,
      },
      { path: "/review/:draftId", element: <p>review</p> },
      { path: "/matches/:matchId", element: <p>result</p> },
      { path: "/other", element: <p>other</p> },
    ],
    { initialEntries: ["/matches"] },
  );
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { commands, router };
}

describe("draft navigation ownership", () => {
  beforeEach(() => setDevUser());

  it.each(["leave", "change filter"])(
    "does not redirect when the user chooses to %s before the status check finishes",
    async (nextAction) => {
      const gate = createDeferred();
      server.use(
        http.get("/api/match-drafts/:draftId", async () => {
          await gate.promise;
          return HttpResponse.json(
            makeMatchDraftReviewResponse("draft-a", {
              confirmedMatchId: "confirmed-a",
              status: "confirmed",
            }).draft,
          );
        }),
      );
      const { commands, router } = renderCommand();
      const user = userEvent.setup();

      await user.click(screen.getByRole("button", { name: "draft-a" }));
      expect(screen.getByRole("button", { name: "draft-a" })).toBeDisabled();
      await user.click(screen.getByRole("button", { name: nextAction }));
      const destination = nextAction === "leave" ? "/other" : "/matches?status=confirmed";
      await act(async () => {
        gate.resolve();
        await Promise.all(commands);
      });

      expect(`${router.state.location.pathname}${router.state.location.search}`).toBe(destination);
      if (nextAction === "change filter") {
        expect(screen.getByRole("button", { name: "draft-a" })).toBeEnabled();
      }
    },
  );

  it.each(["first", "second"])(
    "honors the latest row action when the %s request finishes first",
    async (firstToFinish) => {
      const gates = { "draft-a": createDeferred(), "draft-b": createDeferred() };
      server.use(
        http.get("/api/match-drafts/:draftId", async ({ params }) => {
          const draftId = params["draftId"] === "draft-a" ? "draft-a" : "draft-b";
          await gates[draftId].promise;
          return HttpResponse.json(makeMatchDraftReviewResponse(draftId).draft);
        }),
      );
      const { commands, router } = renderCommand();
      const user = userEvent.setup();

      await user.click(screen.getByRole("button", { name: "draft-a" }));
      await user.click(screen.getByRole("button", { name: "draft-b" }));
      await act(async () => {
        gates[firstToFinish === "first" ? "draft-a" : "draft-b"].resolve();
        await commands[firstToFinish === "first" ? 0 : 1];
      });
      expect(router.state.location.pathname).toBe(
        firstToFinish === "first" ? "/matches" : "/review/draft-b",
      );
      await act(async () => {
        gates[firstToFinish === "first" ? "draft-b" : "draft-a"].resolve();
        await Promise.all(commands);
      });
      expect(router.state.location.pathname).toBe("/review/draft-b");
    },
  );

  it("clears the previous status error while retrying that row", async () => {
    let fail = true;
    const retry = createDeferred();
    server.use(
      http.get("/api/match-drafts/:draftId", async () => {
        if (fail) return HttpResponse.json({ detail: "unavailable" }, { status: 500 });
        await retry.promise;
        return HttpResponse.json(makeMatchDraftReviewResponse("draft-a").draft);
      }),
    );
    const { commands, router } = renderCommand();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "draft-a" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("最新状態を確認できませんでした");
    fail = false;
    await user.click(screen.getByRole("button", { name: "draft-a" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "draft-a" })).toBeDisabled();
    await act(async () => {
      retry.resolve();
      await Promise.all(commands);
    });
    expect(router.state.location.pathname).toBe("/review/draft-a");
  });
});
