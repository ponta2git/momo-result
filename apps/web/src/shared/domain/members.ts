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
