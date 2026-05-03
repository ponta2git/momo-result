import { layoutFamilies } from "@/shared/api/enums";
import type { LayoutFamily } from "@/shared/api/enums";

export function normalizeName(name: string): string {
  return name.trim();
}

export function isNameValid(name: string): boolean {
  return normalizeName(name).length > 0;
}

export function normalizeLayoutFamily(layoutFamily: string): LayoutFamily {
  return layoutFamilies.includes(layoutFamily as LayoutFamily)
    ? (layoutFamily as LayoutFamily)
    : layoutFamilies[0];
}
