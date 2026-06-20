// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { createHeldEvent, deleteHeldEvent, listHeldEvents } from "@/shared/api/heldEvents";
import { setDevUser } from "@/test/auth";
import { setupMsw } from "@/test/msw/lifecycle";

setupMsw();

describe("held events api", () => {
  it("loads held events", async () => {
    setDevUser();

    await expect(listHeldEvents()).resolves.toMatchObject({
      items: [{ id: "held-1" }],
      pagination: { page: 1, pageSize: 10, totalItems: 1 },
      totalMatchCount: 0,
    });
  });

  it("creates held event", async () => {
    setDevUser();

    await expect(
      createHeldEvent(
        { heldAt: "2026-01-01T00:00:00.000Z" },
        { idempotencyKey: "held-event-key-1" },
      ),
    ).resolves.toMatchObject({ id: "held-created" });
  });

  it("deletes held event", async () => {
    setDevUser();

    await expect(deleteHeldEvent("held-1")).resolves.toMatchObject({
      deleted: true,
      heldEventId: "held-1",
    });
  });
});
