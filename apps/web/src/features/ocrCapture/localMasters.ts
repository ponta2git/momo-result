import type { LayoutFamily } from "@/shared/api/enums";

export type FixedMember = {
  memberId: string;
  displayName: string;
  aliases: string[];
};

export const fixedMembers: FixedMember[] = [
  { memberId: "member_ponta", displayName: "ぽんた", aliases: ["ぽんた"] },
  {
    memberId: "member_akane_mami",
    displayName: "あかねまみ",
    aliases: ["あかねまみ", "NO11社長"],
  },
  {
    memberId: "member_otaka",
    displayName: "おーたか",
    aliases: ["おーたか", "オータカ社長"],
  },
  { memberId: "member_eu", displayName: "いーゆー", aliases: ["いーゆー", "いーゆー社長"] },
];

const computerAliasesByLayoutFamily = {
  momotetsu_2: [],
  world: [],
  reiwa: ["さくま"],
} as const satisfies Record<LayoutFamily, readonly string[]>;

export function computerAliasesFor(layoutFamily: LayoutFamily | undefined): readonly string[] {
  if (!layoutFamily) return [];
  return computerAliasesByLayoutFamily[layoutFamily] ?? [];
}
