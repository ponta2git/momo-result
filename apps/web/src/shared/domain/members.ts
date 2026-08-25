/** アプリが固定メンバーとして受け付けるIDの集合。配列順に表示上の意味はない。 */
export const fixedMemberIds = [
  "member_ponta",
  "member_akane_mami",
  "member_otaka",
  "member_eu",
] as const;

export type FixedMemberId = (typeof fixedMemberIds)[number];

export type FixedMember = {
  readonly memberId: string;
  readonly displayName: string;
  readonly defaultAliases: readonly string[];
};

type FixedMemberRegistry = {
  readonly [MemberId in FixedMemberId]: FixedMember & { readonly memberId: MemberId };
};

/** IDから固定メンバーの同一性情報を引く正本。列挙順には依存しないこと。 */
export const fixedMemberRegistry = {
  member_ponta: {
    memberId: "member_ponta",
    displayName: "ぽんた",
    defaultAliases: ["ぽんた"],
  },
  member_akane_mami: {
    memberId: "member_akane_mami",
    displayName: "あかねまみ",
    defaultAliases: ["あかねまみ", "NO11"],
  },
  member_otaka: {
    memberId: "member_otaka",
    displayName: "おーたか",
    defaultAliases: ["おーたか", "オータカ"],
  },
  member_eu: {
    memberId: "member_eu",
    displayName: "いーゆー",
    defaultAliases: ["いーゆー"],
  },
} as const satisfies FixedMemberRegistry;

/**
 * 新規workspaceを初期化する入力slot順。
 * playOrder・rankの初期値およびOCR未解決時のfallbackはこの順を使う。
 */
export const workspaceInputMemberIds = [
  "member_ponta",
  "member_akane_mami",
  "member_otaka",
  "member_eu",
] as const satisfies readonly FixedMemberId[];

export const workspaceInputMembers: readonly FixedMember[] = workspaceInputMemberIds.map(
  (memberId) => fixedMemberRegistry[memberId],
);

/** 新規workspaceの明示的な既定オーナー。slot順から導出しないこと。 */
export const defaultOwnerMemberId: FixedMemberId = "member_ponta";

/**
 * 固定メンバーの結果表示に使うcanonical順。
 * workspaceの入力slot順、playOrder、rank、画像上の並びには適用しないこと。
 */
export const canonicalResultMemberIds = [
  "member_eu",
  "member_ponta",
  "member_akane_mami",
  "member_otaka",
] as const satisfies readonly FixedMemberId[];

/** 固定メンバーをcanonicalな結果表示順で列挙する読み取り専用view。 */
export const canonicalResultMembers: readonly FixedMember[] = canonicalResultMemberIds.map(
  (memberId) => fixedMemberRegistry[memberId],
);

export type MemberSequence = 1 | 2 | 3 | 4;

const memberSequenceById = new Map<string, MemberSequence>(
  canonicalResultMemberIds.map(
    (memberId, index) => [memberId, (index + 1) as MemberSequence] as const,
  ),
);

/** canonicalな固定メンバー順を、青→赤→黄→緑の表示sequenceへ写像する。 */
export function memberSequence(memberId: string): MemberSequence | null {
  return memberSequenceById.get(memberId) ?? null;
}

/**
 * 既存の順序非明示な呼び出し元との互換出口。
 * 新しい順序依存処理では用途に応じてworkspaceInputMembers、canonicalResultMembers、
 * orderFixedMembersのいずれかを使うこと。
 */
export const fixedMembers: readonly FixedMember[] = workspaceInputMembers;

const canonicalResultOrder = new Map<string, number>(
  canonicalResultMemberIds.map((memberId, index) => [memberId, index]),
);

/**
 * memberIdを持つ値をcanonicalな結果表示順へ並べる。
 * 未知IDは既知の4人より後ろへ移し、未知ID同士を含む同順位では入力順を維持する。
 * 入力配列は変更しない。
 */
export function orderFixedMembers<T extends { memberId: string }>(values: readonly T[]): T[] {
  return values
    .map((value, inputIndex) => ({
      inputIndex,
      order: canonicalResultOrder.get(value.memberId),
      value,
    }))
    .toSorted((left, right) => {
      if (left.order !== undefined && right.order !== undefined) {
        return left.order - right.order || left.inputIndex - right.inputIndex;
      }
      if (left.order !== undefined) {
        return -1;
      }
      if (right.order !== undefined) {
        return 1;
      }
      return left.inputIndex - right.inputIndex;
    })
    .map(({ value }) => value);
}

/** 任意の文字列が有効な固定member IDかを判定する。 */
export function isFixedMemberId(memberId: string): memberId is FixedMemberId {
  return Object.hasOwn(fixedMemberRegistry, memberId);
}

export function memberDisplayName(memberId: string | null | undefined): string {
  if (!memberId) {
    return "試合参加者に紐づけない";
  }
  return isFixedMemberId(memberId) ? fixedMemberRegistry[memberId].displayName : memberId;
}
