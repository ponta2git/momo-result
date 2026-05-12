import { fixedMembers } from "@/shared/domain/members";

export type MemberAliasRecord = {
  alias: string;
  memberId: string;
};

export type MemberAliasDirectory = {
  aliasesByMemberId: Map<string, string[]>;
  memberIds: string[];
};

function stripPresidentSuffix(name: string): string {
  return name.replace(/社長\s*$/u, "").trim();
}

function normalizedAlias(alias: string): string {
  return stripPresidentSuffix(alias.trim());
}

function uniqueAliases(aliases: Iterable<string>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const alias of aliases) {
    const normalized = normalizedAlias(alias);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

export function buildMemberAliasDirectory(
  memberAliases: readonly MemberAliasRecord[] = [],
): MemberAliasDirectory {
  const aliasesByMemberId = new Map<string, string[]>();

  for (const member of fixedMembers) {
    aliasesByMemberId.set(
      member.memberId,
      uniqueAliases([
        member.displayName,
        ...member.defaultAliases,
        ...memberAliases
          .filter((alias) => alias.memberId === member.memberId)
          .map((alias) => alias.alias),
      ]),
    );
  }

  return {
    aliasesByMemberId,
    memberIds: fixedMembers.map((member) => member.memberId),
  };
}

export const defaultMemberAliasDirectory = buildMemberAliasDirectory();

export function resolveMemberIdByAlias(
  directory: MemberAliasDirectory,
  rawName: string | null | undefined,
): string | undefined {
  if (!rawName) {
    return undefined;
  }

  const normalized = normalizedAlias(rawName);
  if (!normalized) {
    return undefined;
  }

  for (const [memberId, aliases] of directory.aliasesByMemberId) {
    if (aliases.some((alias) => normalizedAlias(alias) === normalized)) {
      return memberId;
    }
  }

  return undefined;
}

export function playerAliasHints(directory: MemberAliasDirectory): Array<{
  aliases: string[];
  memberId: string;
}> {
  return directory.memberIds.map((memberId) => ({
    memberId,
    aliases: directory.aliasesByMemberId.get(memberId) ?? [],
  }));
}
