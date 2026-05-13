export type FixedMember = {
  memberId: string;
  displayName: string;
  defaultAliases: string[];
};

export const fixedMembers: FixedMember[] = [
  { memberId: "member_ponta", displayName: "ぽんた", defaultAliases: ["ぽんた"] },
  {
    memberId: "member_akane_mami",
    displayName: "あかねまみ",
    defaultAliases: ["あかねまみ", "NO11"],
  },
  {
    memberId: "member_otaka",
    displayName: "おーたか",
    defaultAliases: ["おーたか", "オータカ"],
  },
  { memberId: "member_eu", displayName: "いーゆー", defaultAliases: ["いーゆー"] },
];

export function memberDisplayName(memberId: string | null | undefined): string {
  if (!memberId) {
    return "試合参加者に紐づけない";
  }
  return fixedMembers.find((member) => member.memberId === memberId)?.displayName ?? memberId;
}
