import type { LayoutFamily } from "@/shared/api/enums";

const computerAliasesByLayoutFamily = {
  momotetsu_2: [],
  world: [],
  reiwa: ["さくま"],
} as const satisfies Record<LayoutFamily, readonly string[]>;

export function computerAliasesFor(layoutFamily: LayoutFamily | undefined): readonly string[] {
  if (!layoutFamily) return [];
  return computerAliasesByLayoutFamily[layoutFamily] ?? [];
}
