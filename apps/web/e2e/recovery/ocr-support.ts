import type { Page } from "@playwright/test";

import type { components } from "../../src/shared/api/generated";
import type { CapturedSubmission } from "../contracts/ocr-support";
import { runtime } from "../contracts/ocr-support";
import type { seedMasterContext } from "../fixtures/records";
import type { E2eRun } from "../support";
import {
  expectGeneratedId,
  expectOk,
  readJsonObject,
  selectControlOption,
} from "../system/support";

type SubmissionRequest = components["schemas"]["PutOcrSubmissionRequest"];
export async function prepareRead(
  page: Page,
  masters: Awaited<ReturnType<typeof seedMasterContext>>,
  heldEventId?: string,
) {
  await page.goto(heldEventId ? `/ocr/new?heldEventId=${heldEventId}` : "/ocr/new");
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
  await page.getByLabel("OCRの画像をアップロード").setInputFiles(images.total_assets.path);
}
export async function startRead(page: Page, run: E2eRun): Promise<CapturedSubmission> {
  await page.getByRole("button", { name: "1件で読み取りを開始" }).click();
  const response = page.waitForResponse(
    (value) => value.url().includes("/api/ocr-submissions/") && value.request().method() === "PUT",
  );
  await page
    .getByRole("dialog", { name: "読み取りを開始しますか？" })
    .getByRole("button", { name: "1件で読み取りを開始" })
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
