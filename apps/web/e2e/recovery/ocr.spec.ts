import type { components } from "../../src/shared/api/generated";
import {
  advanceAdmission,
  delivered,
  enableOcrNotifications,
  messages,
  outcomes,
  release,
  reread,
  screens,
  submission,
  waitForStarted,
} from "../contracts/ocr-support";
import { seedHeldEventContext, seedMasterContext } from "../fixtures/records";
import { expect, expectGeneratedId, expectOk, readJsonObject, test } from "../system/support";
import { prepareRead, startRead } from "./ocr-support";

test.beforeEach(async ({ request }) => enableOcrNotifications(request));
test.afterEach(async () => {
  await Promise.all(screens.map((screen) => release(screen)));
});

test("retries a lost OCR response once and continues from the drafts page", async ({
  page,
  request,
  e2eRun,
}) => {
  await outcomes({ total_assets: "hold:success" });
  const masters = await seedMasterContext(request, e2eRun);
  await prepareRead(page, masters);
  const submissionIds = new Set<string>();
  page.on("request", (value) => {
    if (value.method() === "PUT" && value.url().includes("/api/ocr-submissions/"))
      submissionIds.add(new URL(value.url()).pathname.split("/").at(-1) ?? "");
  });
  let lost = false;
  await page.route("**/api/ocr-jobs", async (route) => {
    if (route.request().method() !== "POST" || lost) {
      await route.continue();
      return;
    }
    lost = true;
    // The real endpoint commits before the browser loses its response. Session
    // cookies and the application's CSRF token pass through unchanged.
    const committed = await route.fetch();
    await expectOk(committed, "commit OCR job before losing its response");
    await route.abort("failed");
  });
  const operation = await startRead(page, e2eRun);
  await waitForStarted("total_assets");
  const original = await submission(request, operation.id);
  expect(original.members).toHaveLength(1);
  await page.setViewportSize({ width: 390, height: 844 });
  const retry = page.getByRole("dialog", { name: "読み取りの受付を確認できませんでした" });
  await expect(retry).toBeVisible();
  await retry.getByRole("button", { name: "もう一度試す" }).click();
  await expect(page).toHaveURL(/\/drafts$/u);
  expect((await submission(request, operation.id)).members).toEqual(original.members);
  expect([...submissionIds]).toEqual([operation.id]);
  await release("total_assets");
  await delivered(request, operation);
  expect(await messages(operation.id)).toHaveLength(1);
  await page.getByRole("button", { name: "最新情報に更新", exact: true }).click();
  const draftRow = page.getByRole("listitem").filter({ hasText: masters.mapName });
  await draftRow.getByRole("button", { name: /^(内容を確認|確認事項を直す)$/u }).click();
  await expect(page).toHaveURL(`/review/${operation.draftId}`);
  await expect(page.getByRole("button", { name: "確定前の確認へ進む" })).toBeEnabled();
});

test("settles an interrupted upload and lets a failed reread be completed by hand", async ({
  page,
  request,
  context,
  e2eRun,
}) => {
  await outcomes({});
  const fixture = await seedHeldEventContext(request, e2eRun);
  await prepareRead(page, fixture, fixture.heldEventId);
  await page.route("**/api/uploads/images", (route) => route.abort("failed"));
  const operation = await startRead(page, e2eRun);
  await page.close();
  const admitted = await submission(request, operation.id);
  expect(admitted.members).toHaveLength(1);
  expect(admitted.members?.every((member) => !member.jobId)).toBe(true);
  await advanceAdmission(operation.id);
  expect(await delivered(request, operation)).toContain("総資産");
  const closed = await submission(request, operation.id);
  expect(closed.members).toHaveLength(1);
  expect(
    closed.members?.every((member) => member.failureCode === "admission_timeout" && !member.jobId),
  ).toBe(true);

  await outcomes({ total_assets: "failed" });
  const next = await reread(request, operation, e2eRun);
  expect(next.id).not.toBe(operation.id);
  expect(next.draftId).toBe(operation.draftId);
  expect(await delivered(request, next)).toContain("総資産");
  const jobId = expectGeneratedId(
    (await submission(request, next.id)).members?.[0]?.jobId,
    "failed reread job",
  );
  const failedJob = await request.get(`/api/ocr-jobs/${jobId}`);
  await expectOk(failedJob, "read failed reread outcome");
  expect((await readJsonObject(failedJob))["status"]).toBe("failed");
  expect(await submission(request, operation.id)).toEqual(closed);

  const reopened = await context.newPage();
  await reopened.goto(`/review/${operation.draftId}`);
  await expect(reopened.getByRole("button", { name: "確定前の確認へ進む" })).toBeEnabled();
  await expect(reopened.getByLabel("ぽんた 総資産（万円）", { exact: true })).toHaveValue("0");
  for (const [index, name] of ["ぽんた", "あかねまみ", "おーたか", "いーゆー"].entries()) {
    await reopened.getByLabel(`${name} 順位`, { exact: true }).fill(String(index + 1));
    await reopened
      .getByLabel(`${name} 総資産（万円）`, { exact: true })
      .fill(String((4 - index) * 100));
    await reopened
      .getByLabel(`${name} 収益（万円）`, { exact: true })
      .fill(String((4 - index) * 10));
  }
  await reopened.getByRole("button", { name: "確定前の確認へ進む" }).click();
  const confirmation = reopened.waitForResponse(
    (response) => response.url().endsWith("/api/matches") && response.request().method() === "POST",
  );
  await reopened
    .getByRole("dialog", { name: "この内容で確定しますか？" })
    .getByRole("button", { name: "確定する" })
    .click();
  const response = await confirmation;
  await expectOk(response, "confirm manually recovered OCR draft");
  const matchId = expectGeneratedId((await readJsonObject(response))["matchId"], "recovered match");
  e2eRun.trackMatch(matchId);
  await expect(reopened).toHaveURL(`/matches/${matchId}`);
  await reopened.reload();
  await expect(reopened.getByRole("region", { name: "順位・総資産" })).toBeVisible();
  const saved = await request.get(`/api/matches/${matchId}`);
  await expectOk(saved, "read manually recovered match");
  const result = (await saved.json()) as components["schemas"]["MatchDetailResponse"];
  expect(result.heldEventId).toBe(fixture.heldEventId);
  expect(
    result.players?.map(({ memberId, rank, totalAssetsManYen, revenueManYen }) => ({
      memberId,
      rank,
      totalAssetsManYen,
      revenueManYen,
    })),
  ).toEqual(
    ["member_ponta", "member_akane_mami", "member_otaka", "member_eu"].map((memberId, index) => ({
      memberId,
      rank: index + 1,
      totalAssetsManYen: (4 - index) * 100,
      revenueManYen: (4 - index) * 10,
    })),
  );
});
