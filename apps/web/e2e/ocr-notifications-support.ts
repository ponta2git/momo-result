import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";

import type { APIRequestContext, Page } from "@playwright/test";
import { z } from "zod";

import type { components } from "../src/shared/api/generated";
import { seedMasterContext as seedMasters } from "./fixtures/records";
import {
  expect,
  expectGeneratedId,
  expectOk,
  readJsonObject,
  selectControlOption,
} from "./support";
export { seedMasters };
import type { E2eRun } from "./support";

type SubmissionRequest = components["schemas"]["PutOcrSubmissionRequest"];
export type Submission = components["schemas"]["OcrSubmissionResponse"];
export type Screen = "total_assets" | "revenue" | "incident_log";
export const screens: Screen[] = ["total_assets", "revenue", "incident_log"];
export const headers = { "X-Momo-Account-Id": "account_ponta", "X-CSRF-Token": "dev" };
export type CapturedSubmission = { id: string; draftId: string; request: SubmissionRequest };
type Message = { body: { content: string; nonce: string; allowedMentions: { parse: string[] } } };
const runtimeSchema = z.object({
  runDir: z.string().min(1),
  controlDir: z.string().min(1),
  messagesFile: z.string().min(1),
  postgresContainer: z.string().regex(/^[0-9a-f]{64}$/u),
  databaseName: z.literal("mom24_e2e"),
  webOrigin: z.url(),
  images: z.record(
    z.enum(["total_assets", "revenue", "incident_log"]),
    z.object({
      path: z.string().min(1),
      size: z.number().int().positive(),
      sha256: z.string().regex(/^[0-9a-f]{64}$/u),
    }),
  ),
});
type Runtime = z.infer<typeof runtimeSchema>;
const notificationSettingsSchema = z.object({
  ocrCompleted: z.object({ enabled: z.boolean(), generation: z.string() }),
  analysisCompleted: z.object({ enabled: z.boolean(), generation: z.string() }),
});
const execute = promisify(execFile);

export async function runtime(): Promise<Runtime> {
  const path = process.env["MOM24_E2E_METADATA"];
  if (!path) throw new Error("Use the isolated OCR notification runner.");
  const parsed = runtimeSchema.safeParse(JSON.parse(await readFile(path, "utf8")));
  if (!parsed.success) throw new Error("Invalid isolated OCR E2E metadata.");
  const result = parsed.data;
  if (
    !basename(result.runDir).startsWith("mom24_e2e_") ||
    result.databaseName !== "mom24_e2e" ||
    resolve(result.controlDir) !== join(resolve(result.runDir), "control") ||
    resolve(result.messagesFile) !==
      join(resolve(result.runDir), "recorder", "summit-messages.jsonl") ||
    screens.some(
      (screen) =>
        resolve(result.images[screen].path) !== join(resolve(result.runDir), `${screen}.png`),
    )
  ) {
    throw new Error("Only the owned OCR E2E database may be observed or advanced.");
  }
  return result;
}

export async function outcomes(values: Partial<Record<Screen, string>>) {
  const { controlDir } = await runtime();
  for (const screen of screens) {
    await rm(join(controlDir, `${screen}.started`), { force: true });
    await rm(join(controlDir, `${screen}.release`), { force: true });
    await writeFile(join(controlDir, `${screen}.outcome`), values[screen] ?? "success");
  }
}
export async function release(screen: Screen) {
  await writeFile(join((await runtime()).controlDir, `${screen}.release`), "release\n");
}
export async function waitForRecheck() {
  const path = join((await runtime()).controlDir, "coordinator.checkpoint");
  const before = Number(await readFile(path, "utf8"));
  await expect
    .poll(async () => Number(await readFile(path, "utf8")), { timeout: 45_000 })
    .toBeGreaterThan(before);
}
export async function waitForStarted(screen: Screen) {
  await expect
    .poll(async () =>
      readFile(join((await runtime()).controlDir, `${screen}.started`), "utf8").catch(() => ""),
    )
    .not.toBe("");
}
export async function submission(request: APIRequestContext, id: string): Promise<Submission> {
  const response = await request.get(`/api/ocr-submissions/${id}`, { headers });
  await expectOk(response, "read submission");
  return response.json() as Promise<Submission>;
}
export async function sql(query: string): Promise<string> {
  const target = await runtime();
  const result = await execute("docker", [
    "exec",
    target.postgresContainer,
    "psql",
    "-U",
    "postgres",
    "-d",
    target.databaseName,
    "-XAt",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    query,
  ]);
  return result.stdout.trim();
}
function validatedId(id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(id))
    throw new Error("Expected an owned submission UUID.");
  return id;
}
export async function advanceAdmission(id: string) {
  // Only the saved group from this test is advanced. The real coordinator closes it.
  await sql(
    `UPDATE ocr_submissions SET created_at = clock_timestamp() - interval '2 seconds', admission_deadline = clock_timestamp() - interval '1 second' WHERE id = '${validatedId(id)}' AND status = 'open'`,
  );
}
export async function successfulMembers(id: string) {
  return Number(
    await sql(
      `SELECT count(*) FROM ocr_submission_members m JOIN ocr_jobs j ON j.id=m.job_id WHERE m.submission_id='${validatedId(id)}' AND j.status IN ('succeeded','needs_review')`,
    ),
  );
}
export async function receipt(id: string) {
  const raw = await sql(
    `SELECT json_build_object('status',status,'schemaVersion',schema_version,'rendererVersion',renderer_version,'partCount',part_count,'payload',payload) FROM discord_notifications WHERE id='result:ocr_completed:submission:${validatedId(id)}'`,
  );
  return raw ? JSON.parse(raw) : null;
}
export async function messages(id: string): Promise<Message[]> {
  const nonce = createHash("sha256")
    .update(JSON.stringify([`result:ocr_completed:submission:${id}`, 0]))
    .digest("base64url")
    .slice(0, 25);
  const text = await readFile((await runtime()).messagesFile, "utf8");
  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Message)
    .filter((message) => message.body.nonce === nonce);
}
export async function delivered(request: APIRequestContext, operation: CapturedSubmission) {
  await expect
    .poll(async () => (await submission(request, operation.id)).status, { timeout: 45_000 })
    .toBe("settled");
  await expect
    .poll(async () => (await receipt(operation.id))?.status, { timeout: 45_000 })
    .toBe("DELIVERED");
  expect(await receipt(operation.id)).toMatchObject({
    schemaVersion: 2,
    rendererVersion: 2,
    partCount: 1,
  });
  await waitForRecheck();
  const recorded = await messages(operation.id);
  expect(recorded).toHaveLength(1);
  const first = recorded[0];
  if (!first) throw new Error("No recorded message.");
  expect(first.body.allowedMentions.parse).toEqual([]);
  expect(first.body.content).toContain(`/review/${operation.draftId}`);
  return first.body.content;
}
export async function enableOcrNotifications(request: APIRequestContext) {
  const response = await request.get("/api/admin/notification-settings", { headers });
  await expectOk(response, "read notification settings");
  const current = notificationSettingsSchema.parse(await response.json());
  await expectOk(
    await request.put("/api/admin/notification-settings", {
      headers,
      data: {
        ocrCompleted: { enabled: true, expectedGeneration: current.ocrCompleted.generation },
        analysisCompleted: {
          enabled: current.analysisCompleted.enabled,
          expectedGeneration: current.analysisCompleted.generation,
        },
      } satisfies components["schemas"]["NotificationSettingsUpdateRequest"],
    }),
    "enable this test's OCR notifications",
  );
}

export async function prepareRead(
  page: Page,
  masters: Awaited<ReturnType<typeof seedMasters>>,
  count: number,
) {
  await page.goto("/ocr/new");
  await selectControlOption(
    page,
    page.getByRole("combobox", { name: /^作品/u }),
    masters.gameTitleId,
  );
  await selectControlOption(
    page,
    page.getByRole("combobox", { name: /^シーズン/u }),
    masters.seasonMasterId,
  );
  await selectControlOption(
    page,
    page.getByRole("combobox", { name: /^マップ/u }),
    masters.mapMasterId,
  );
  const { images } = await runtime();
  for (const screen of screens.slice(0, count))
    await page.getByLabel("OCRの画像をアップロード").setInputFiles(images[screen].path);
}
export async function startRead(
  page: Page,
  run: E2eRun,
  count: number,
): Promise<CapturedSubmission> {
  await page.getByRole("button", { name: `${count}件で読み取りを開始` }).click();
  const response = page.waitForResponse(
    (value) => value.url().includes("/api/ocr-submissions/") && value.request().method() === "PUT",
  );
  await page
    .getByRole("dialog", { name: "読み取りを開始しますか？" })
    .getByRole("button", { name: `${count}件で読み取りを開始` })
    .click();
  const result = await response;
  await expectOk(result, "create submission");
  const body = await readJsonObject(result);
  const draftId = expectGeneratedId(body["matchDraftId"], "OCR match draft ID");
  const id = expectGeneratedId(body["submissionId"], "OCR submission ID");
  run.trackDraft(draftId);
  return {
    id,
    draftId,
    request: result.request().postDataJSON() as SubmissionRequest,
  };
}
export async function reread(
  request: APIRequestContext,
  previous: CapturedSubmission,
  run: E2eRun,
): Promise<CapturedSubmission> {
  const id = randomUUID();
  const key = run.nextIdempotencyKey("reread");
  const image = (await runtime()).images.total_assets;
  const body: SubmissionRequest = {
    ...previous.request,
    members: [
      {
        screenType: "total_assets",
        uploadIdempotencyKey: key,
        imageSha256: image.sha256,
        imageByteLength: image.size,
      },
    ],
  };
  await expectOk(
    await request.put(`/api/ocr-submissions/${id}`, { headers, data: body }),
    "new read on same draft",
  );
  const uploaded = await request.post("/api/uploads/images", {
    headers: { ...headers, "Idempotency-Key": key },
    multipart: {
      file: { name: "total_assets.png", mimeType: "image/png", buffer: await readFile(image.path) },
    },
  });
  await expectOk(uploaded, "upload reread image");
  const imageId = expectGeneratedId(
    (await readJsonObject(uploaded))["imageId"],
    "uploaded image ID",
  );
  await expectOk(
    await request.post("/api/ocr-jobs", {
      headers: { ...headers, "Idempotency-Key": key },
      data: { imageId, submissionId: id, requestedScreenType: "total_assets" },
    }),
    "create reread job",
  );
  return { id, draftId: previous.draftId, request: body };
}
