import { describe, expect, it } from "vitest";

import { createHeldEvent, deleteHeldEvent, listHeldEvents } from "@/shared/api/heldEvents";

describe("held events api", () => {
  it("loads held events", async () => {
    window.localStorage.setItem("momoresult.devUser", "account_ponta");

    await expect(listHeldEvents()).resolves.toMatchObject({
      items: [{ id: "held-1" }],
    });
  });

  it("creates held event", async () => {
    window.localStorage.setItem("momoresult.devUser", "account_ponta");

    await expect(createHeldEvent({ heldAt: "2026-01-01T00:00:00.000Z" })).resolves.toMatchObject({
      id: "held-created",
    });
  });

  it("deletes held event", async () => {
    window.localStorage.setItem("momoresult.devUser", "account_ponta");

    await expect(deleteHeldEvent("held-1")).resolves.toMatchObject({
      deleted: true,
      heldEventId: "held-1",
    });
  });
});
