import { expect, test } from "../system/support";
import {
  createRead,
  delivered,
  enableOcrNotifications,
  messages,
  outcomes,
  release,
  reread,
  screens,
  seedMasters,
  submission,
  successfulMembers,
  waitForRecheck,
  waitForStarted,
} from "./ocr-support";

// The controlled Worker and notification settings are owned by this isolated run.
// One worker serializes their use; no browser fixture is requested by these tests.
test.beforeEach(async ({ request }) => enableOcrNotifications(request));
test.afterEach(async () => {
  await Promise.all(screens.map((screen) => release(screen)));
});

test("waits for every admitted image and delivers one grouped result", async ({
  request,
  e2eRun,
}) => {
  await outcomes({
    total_assets: "needs_review",
    revenue: "success",
    incident_log: "hold:success",
  });
  const operation = await createRead(request, e2eRun, await seedMasters(request, e2eRun), screens);
  await waitForStarted("incident_log");
  await expect.poll(() => successfulMembers(operation.id)).toBe(2);
  await waitForRecheck();
  expect((await submission(request, operation.id)).status).toBe("open");
  expect(await messages(operation.id)).toEqual([]);
  await release("incident_log");
  expect(await delivered(request, operation)).not.toMatch(/成功|要確認|[123]件/u);
});

for (const allFailed of [false, true]) {
  test(`${allFailed ? "total" : "partial"} failures notify only failed screens`, async ({
    request,
    e2eRun,
  }) => {
    await outcomes({
      total_assets: "failed",
      revenue: allFailed ? "failed" : "success",
      incident_log: allFailed ? "failed" : "success",
    });
    const operation = await createRead(
      request,
      e2eRun,
      await seedMasters(request, e2eRun),
      screens,
    );
    const text = await delivered(request, operation);
    expect(text).toContain("総資産");
    expect(text).not.toMatch(/成功|要確認|ParserFailed|fixture_/u);
    if (allFailed) {
      expect(text.indexOf("総資産")).toBeLessThan(text.indexOf("収益"));
      expect(text.indexOf("収益")).toBeLessThan(text.indexOf("事件簿"));
    } else {
      expect(text).not.toMatch(/収益|事件簿/u);
    }
  });
}

test("a new read on the same draft leaves its earlier operation and result unchanged", async ({
  request,
  e2eRun,
}) => {
  await outcomes({ total_assets: "success" });
  const original = await createRead(request, e2eRun, await seedMasters(request, e2eRun), [
    "total_assets",
  ]);
  const originalText = await delivered(request, original);
  const originalState = await submission(request, original.id);
  await outcomes({ total_assets: "failed" });
  const next = await reread(request, original, e2eRun);
  expect(next.id).not.toBe(original.id);
  expect(next.draftId).toBe(original.draftId);
  expect(await delivered(request, next)).toContain("総資産");
  expect(await submission(request, original.id)).toEqual(originalState);
  expect((await messages(original.id))[0]?.body.content).toBe(originalText);
});
