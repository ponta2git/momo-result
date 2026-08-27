import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { useMatchListLocationState } from "@/features/matches/list/useMatchListLocationState";

function LocationStateHarness() {
  const state = useMatchListLocationState();
  const location = useLocation();
  return (
    <>
      <output aria-label="current search">{JSON.stringify(state.current)}</output>
      <output aria-label="list return path">{state.listReturnTo}</output>
      <output aria-label="location">{`${location.pathname}${location.search}`}</output>
      <button type="button" onClick={state.clear}>
        clear
      </button>
    </>
  );
}

describe("useMatchListLocationState", () => {
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
});
