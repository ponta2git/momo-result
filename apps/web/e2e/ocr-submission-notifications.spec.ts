import {
  advanceAdmission,
  delivered,
  enableOcrNotifications,
  headers,
  messages,
  outcomes,
  prepareRead,
  release,
  screens,
  reread,
  seedMasters,
  startRead,
  submission,
  successfulMembers,
  waitForRecheck,
  waitForStarted,
} from "./ocr-notifications-support";
import {
  test,
  expect,
  installE2eAuthHeaders,
  e2eAuthHeaders,
  expectNoHorizontalPageOverflow,
} from "./support";

// One controlled worker and notification setting are shared by this dedicated runtime.
// Config workers=1 serializes access; each case establishes its own setting and releases gates.
test.beforeEach(async ({ page, request }) => {
  await installE2eAuthHeaders(page);
  await enableOcrNotifications(request);
});
test.afterEach(async () => {
  await Promise.all(screens.map((screen) => release(screen)));
});

test("E1: one operation waits for every image and posts one result", async ({
  page,
  request,
  e2eRun,
}) => {
  await page.goto("/admin/masters");
  await page.getByRole("tab", { name: "通知", exact: true }).click();
  const checkbox = page.getByRole("checkbox", { name: "OCR完了", exact: true });
  // Save and reload both values through the user-facing setting path.
  if (await checkbox.isChecked()) {
    await checkbox.uncheck();
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "OFFにして保存" }).click();
    await expect(page.getByText("通知設定を保存しました。", { exact: true })).toBeVisible();
  }
  await page.reload();
  await page.getByRole("tab", { name: "通知", exact: true }).click();
  await expect(checkbox).not.toBeChecked();
  await checkbox.check();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("通知設定を保存しました。", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("tab", { name: "通知", exact: true }).click();
  await expect(checkbox).toBeChecked();

  await outcomes({
    total_assets: "needs_review",
    revenue: "success",
    incident_log: "hold:success",
  });
  await prepareRead(page, await seedMasters(request, e2eRun), 3);
  const operation = await startRead(page, e2eRun, 3);
  await waitForStarted("incident_log");
  await expect.poll(() => successfulMembers(operation.id)).toBe(2);
  await waitForRecheck();
  expect((await submission(request, operation.id)).status).toBe("open");
  expect(await messages(operation.id)).toEqual([]);
  await release("incident_log");
  const text = await delivered(request, operation);
  expect(text).not.toMatch(/成功|要確認|[123]件/u);
  await page.goto(`/review/${operation.draftId}`);
  await expect(page.getByRole("region", { name: "試合内容", exact: true })).toBeVisible();
});

test("E2: partial and total failures each have one failure-only notification", async ({
  page,
  request,
  e2eRun,
}) => {
  const masters = await seedMasters(request, e2eRun);
  for (const allFailed of [false, true]) {
    await outcomes({
      total_assets: "failed",
      revenue: allFailed ? "failed" : "success",
      incident_log: allFailed ? "failed" : "success",
    });
    await prepareRead(page, masters, 3);
    const operation = await startRead(page, e2eRun, 3);
    const text = await delivered(request, operation);
    expect(text).toContain("総資産");
    expect(text).not.toMatch(/成功|要確認|ParserFailed|fixture_/u);
    if (allFailed) {
      expect(text.indexOf("総資産")).toBeLessThan(text.indexOf("収益"));
      expect(text.indexOf("収益")).toBeLessThan(text.indexOf("事件簿"));
    } else {
      expect(text).not.toMatch(/収益|事件簿/u);
    }
    await page.goto(`/review/${operation.draftId}`);
    await expect(page.getByRole("region", { name: "試合内容", exact: true })).toBeVisible();
  }
});

test("E3: lost job response retries the same operation; an explicit reread creates another", async ({
  page,
  request,
  e2eRun,
}) => {
  await outcomes({ total_assets: "hold:success" });
  await prepareRead(page, await seedMasters(request, e2eRun), 1);
  const submissionIds = new Set<string>();
  page.on("request", (value) => {
    if (value.method() === "PUT" && value.url().includes("/api/ocr-submissions/"))
      submissionIds.add(new URL(value.url()).pathname.split("/").at(-1) ?? "");
  });
  let lost = false;
  await page.route("**/api/ocr-jobs", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    if (lost) {
      await route.continue({ headers: e2eAuthHeaders(route.request()) });
    } else {
      lost = true;
      const committed = await route.fetch({ headers: e2eAuthHeaders(route.request()) });
      expect(committed.ok()).toBe(true);
      await route.abort("failed");
    }
  });
  const operation = await startRead(page, e2eRun, 1);
  await waitForStarted("total_assets");
  const original = await submission(request, operation.id);
  expect(original.members).toHaveLength(1);
  await page.setViewportSize({ width: 390, height: 844 });
  const retry = page.getByRole("dialog", { name: "読み取りの受付を確認できませんでした" });
  await expect(retry).toBeVisible();
  await expectNoHorizontalPageOverflow(page);
  await retry.getByRole("button", { name: "もう一度試す" }).click();
  await expect(page).toHaveURL(/\/matches\?status=incomplete&sort=updated_desc$/u);
  expect((await submission(request, operation.id)).members).toEqual(original.members);
  expect([...submissionIds]).toEqual([operation.id]);
  await release("total_assets");
  const firstText = await delivered(request, operation);
  await outcomes({ total_assets: "failed" });
  const next = await reread(request, operation, e2eRun);
  expect(next.id).not.toBe(operation.id);
  expect(next.draftId).toBe(operation.draftId);
  expect(await delivered(request, next)).toContain("総資産");
  expect((await messages(operation.id))[0]?.body.content).toBe(firstText);
  expect((await submission(request, operation.id)).members).toEqual(original.members);
});

test("E4: closing before any upload still settles and a new read remains possible", async ({
  page,
  request,
  context,
  e2eRun,
}) => {
  await outcomes({});
  await prepareRead(page, await seedMasters(request, e2eRun), 1);
  await page.route("**/api/uploads/images", (route) => route.abort("failed"));
  const operation = await startRead(page, e2eRun, 1);
  await page.close();
  const admitted = await submission(request, operation.id);
  expect(admitted.members).toHaveLength(1);
  expect(admitted.members?.every((member) => !member.jobId)).toBe(true);
  await advanceAdmission(operation.id);
  const text = await delivered(request, operation);
  expect(text).toContain("総資産");
  const closed = await submission(request, operation.id);
  expect(closed.members).toHaveLength(1);
  expect(
    closed.members?.every((member) => member.failureCode === "admission_timeout" && !member.jobId),
  ).toBe(true);
  const reopened = await context.newPage();
  await installE2eAuthHeaders(reopened);
  await reopened.goto(`/review/${operation.draftId}`);
  await expect(reopened.getByRole("region", { name: "試合内容", exact: true })).toBeVisible();
  const next = await reread(request, operation, e2eRun);
  expect(next.id).not.toBe(operation.id);
  await delivered(request, next);
  const old = await request.get(`/api/ocr-submissions/${operation.id}`, { headers });
  expect(await old.json()).toEqual(closed);
});
