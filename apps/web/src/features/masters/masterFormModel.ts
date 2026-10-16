import {
  createGameTitleId,
  createMapMasterId,
  createSeasonMasterId,
} from "@/features/masters/masterId";
import { isNameValid, normalizeName, parseLayoutFamily } from "@/features/masters/masterValidation";
import type { LayoutFamily } from "@/shared/domain/ocr";

type FormResult<Request> = { kind: "ready"; request: Request } | { kind: "invalid"; error: string };
type GameTitleIntent = { name: string; layoutFamily: LayoutFamily };
type ScopedMasterIntent = { name: string; gameTitleId: string };
type ScopedMasterKind = "map" | "season";
export type MasterEditValues = { name: string; layoutFamily?: string | undefined };
export type MasterCreateDrafts = Record<
  string,
  { value: string; version: string | number | undefined }
>;

export function masterCreateDraftValue(
  drafts: MasterCreateDrafts,
  scope: string,
  version: string | number | undefined,
): string {
  const draft = drafts[scope];
  return draft && draft.version === version ? draft.value : "";
}

export function parseGameTitleCreate(formData: FormData): FormResult<GameTitleIntent> {
  const name = normalizeName(String(formData.get("name") ?? ""));
  if (!isNameValid(name)) return { kind: "invalid", error: "作品名を入力してください" };
  const layoutFamily = parseLayoutFamily(String(formData.get("layoutFamily") ?? ""));
  return layoutFamily
    ? { kind: "ready", request: { name, layoutFamily } }
    : { kind: "invalid", error: "読み取り方式を選択してください" };
}

export function parseScopedMasterCreate(
  kind: ScopedMasterKind,
  gameTitleId: string,
  formData: FormData,
): FormResult<ScopedMasterIntent> {
  const name = normalizeName(String(formData.get("name") ?? ""));
  if (!isNameValid(name) || !gameTitleId) {
    return {
      kind: "invalid",
      error: kind === "map" ? "マップ名を入力してください" : "シーズン名を入力してください",
    };
  }
  return { kind: "ready", request: { name, gameTitleId } };
}

/** The optimistic row and its submitted request share one stable creation identity. */
export function prepareGameTitleCreation(
  intent: GameTitleIntent,
  attemptKey: string,
  createdAt: string,
  displayOrder: number,
) {
  const request = { id: createGameTitleId(intent.name, attemptKey), ...intent };
  return { request, optimistic: { ...request, displayOrder, createdAt, pending: true } };
}

export function prepareScopedMasterCreation(
  kind: ScopedMasterKind,
  intent: ScopedMasterIntent,
  attemptKey: string,
  createdAt: string,
  displayOrder: number,
) {
  const id =
    kind === "map"
      ? createMapMasterId(intent.name, attemptKey)
      : createSeasonMasterId(intent.name, attemptKey);
  const request = { id, ...intent };
  return { request, optimistic: { ...request, displayOrder, createdAt, pending: true } };
}

export function readMasterEditForm(
  formData: FormData,
  showLayoutFamily: boolean,
  initialLayoutFamily: string | undefined,
): MasterEditValues {
  return {
    name: String(formData.get("name") ?? ""),
    layoutFamily: showLayoutFamily
      ? String(formData.get("layoutFamily") ?? initialLayoutFamily ?? "")
      : undefined,
  };
}

export function normalizeGameTitleEdit(input: {
  name: string;
  layoutFamily: string;
}): FormResult<GameTitleIntent> {
  const layoutFamily = parseLayoutFamily(input.layoutFamily);
  return layoutFamily
    ? { kind: "ready", request: { name: normalizeName(input.name), layoutFamily } }
    : { kind: "invalid", error: "読み取り方式を選択してください" };
}

export function normalizeMasterNameEdit(input: { name: string }) {
  return { name: normalizeName(input.name) };
}

export function readMemberAliasForm(formData: FormData) {
  return {
    memberId: String(formData.get("memberId") ?? ""),
    alias: String(formData.get("alias") ?? ""),
  };
}

export function normalizeMemberAliasEdit(input: { memberId: string; alias: string }) {
  return { memberId: normalizeName(input.memberId), alias: normalizeName(input.alias) };
}

export function parseMemberAliasCreate(
  formData: FormData,
): FormResult<{ memberId: string; alias: string }> {
  const request = normalizeMemberAliasEdit(readMemberAliasForm(formData));
  return request.memberId && request.alias
    ? { kind: "ready", request }
    : { kind: "invalid", error: "プレーヤーと別名を入力してください" };
}
