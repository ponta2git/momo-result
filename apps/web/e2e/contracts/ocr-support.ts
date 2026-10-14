import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";

import type { APIRequestContext } from "@playwright/test";
import { z } from "zod";

import type { components } from "../../src/shared/api/generated";
import { seedMasterContext as seedMasters } from "../fixtures/records";
import { postJson } from "../support";
import type { E2eRun } from "../support";
import { expect, expectGeneratedId, expectOk, readJsonObject } from "../system/support";

export { seedMasters };

type SubmissionRequest = components["schemas"]["PutOcrSubmissionRequest"];
export type Submission = components["schemas"]["OcrSubmissionResponse"];
export type Screen = "total_assets" | "revenue" | "incident_log";
export const screens: Screen[] = ["total_assets", "revenue", "incident_log"];
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
  const path = process.env["MOMO_E2E_METADATA"];
  if (!path) throw new Error("Use the isolated system runner.");
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
  const response = await request.get(`/api/ocr-submissions/${id}`);
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
  const recorded = await messages(operation.id);
  expect(recorded).toHaveLength(1);
  const first = recorded[0];
  if (!first) throw new Error("No recorded message.");
  expect(first.body.allowedMentions.parse).toEqual([]);
  expect(first.body.content).toContain(`/review/${operation.draftId}`);
  return first.body.content;
}
export async function enableOcrNotifications(request: APIRequestContext) {
  const headers = await mutationHeaders(request);
  const response = await request.get("/api/admin/notification-settings");
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

/** Build admissions through the HTTP API; browser work belongs to recovery specs. */
export async function createRead(
  request: APIRequestContext,
  run: E2eRun,
  masters: Awaited<ReturnType<typeof seedMasters>>,
  members: Screen[],
): Promise<CapturedSubmission> {
  const created = await postJson(request, run, "/api/match-drafts", {
    gameTitleId: masters.gameTitleId,
    mapMasterId: masters.mapMasterId,
    seasonMasterId: masters.seasonMasterId,
    ownerMemberId: "member_ponta",
    playedAt: "2026-01-01T00:00:00.000Z",
    status: "draft_ready",
  } satisfies components["schemas"]["CreateMatchDraftRequest"]);
  const draftId = expectGeneratedId(created["matchDraftId"], "contract OCR draft");
  run.trackDraft(draftId);
  return admitAndUpload(
    request,
    run,
    {
      matchDraftId: draftId,
      ocrHints: {
        gameTitle: masters.gameTitleName,
        layoutFamily: "momotetsu_2",
        knownPlayerAliases: [],
        computerPlayerAliases: [],
      },
    },
    members,
  );
}

export async function reread(
  request: APIRequestContext,
  previous: CapturedSubmission,
  run: E2eRun,
): Promise<CapturedSubmission> {
  return admitAndUpload(request, run, previous.request, ["total_assets"]);
}

async function admitAndUpload(
  request: APIRequestContext,
  run: E2eRun,
  previousRequest: SubmissionRequest,
  screenTypes: Screen[],
): Promise<CapturedSubmission> {
  const headers = await mutationHeaders(request);
  const id = randomUUID();
  const { images } = await runtime();
  const body: SubmissionRequest = {
    ...previousRequest,
    members: screenTypes.map((screen) => ({
      screenType: screen,
      uploadIdempotencyKey: run.nextIdempotencyKey(`ocr-${screen}`),
      imageSha256: images[screen].sha256,
      imageByteLength: images[screen].size,
    })),
  };
  await expectOk(
    await request.put(`/api/ocr-submissions/${id}`, { headers, data: body }),
    "admit OCR operation",
  );
  for (const member of body.members ?? []) {
    const screen = screens.find((value) => value === member.screenType);
    if (!screen) throw new Error("Unexpected owned OCR screen");
    const image = images[screen];
    const memberHeaders = { ...headers, "Idempotency-Key": member.uploadIdempotencyKey };
    const uploaded = await request.post("/api/uploads/images", {
      headers: memberHeaders,
      multipart: {
        file: { name: `${screen}.png`, mimeType: "image/png", buffer: await readFile(image.path) },
      },
    });
    await expectOk(uploaded, "upload contract image");
    const imageId = expectGeneratedId(
      (await readJsonObject(uploaded))["imageId"],
      "uploaded image ID",
    );
    await expectOk(
      await request.post("/api/ocr-jobs", {
        headers: memberHeaders,
        data: { imageId, submissionId: id, requestedScreenType: screen },
      }),
      "create contract OCR job",
    );
  }
  return { id, draftId: previousRequest.matchDraftId, request: body };
}

async function mutationHeaders(request: APIRequestContext): Promise<Record<string, string>> {
  const response = await request.get("/api/auth/me");
  await expectOk(response, "read mutation session");
  const body = await readJsonObject(response);
  if (typeof body["csrfToken"] !== "string") throw new Error("Missing session mutation token");
  return { "X-CSRF-Token": body["csrfToken"] };
}
