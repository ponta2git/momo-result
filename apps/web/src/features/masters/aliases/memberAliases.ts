import type { MemberAliasListResponse, MemberAliasResponse } from "@/shared/api/masters";
import { canonicalResultMembers } from "@/shared/domain/members";

type FormResult<Request> = { kind: "ready"; request: Request } | { kind: "invalid"; error: string };

export function readMemberAliasForm(formData: FormData) {
  return {
    memberId: String(formData.get("memberId") ?? ""),
    alias: String(formData.get("alias") ?? ""),
  };
}

export function normalizeMemberAliasEdit(input: { memberId: string; alias: string }) {
  return { memberId: input.memberId.trim(), alias: input.alias.trim() };
}

export function parseMemberAliasCreate(
  formData: FormData,
): FormResult<{ memberId: string; alias: string }> {
  const request = normalizeMemberAliasEdit(readMemberAliasForm(formData));
  return request.memberId && request.alias
    ? { kind: "ready", request }
    : { kind: "invalid", error: "プレーヤーと別名を入力してください" };
}

export function groupMemberAliases(aliases: ReadonlyArray<Readonly<MemberAliasResponse>>) {
  return canonicalResultMembers.map((member) => ({
    member,
    aliases: aliases.filter((alias) => alias.memberId === member.memberId),
  }));
}

export const selectMemberAliases = (response: MemberAliasListResponse) =>
  (response.items ?? []).toSorted(
    (a, b) => a.memberId.localeCompare(b.memberId) || a.alias.localeCompare(b.alias, "ja"),
  );
