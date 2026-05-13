import { parseLayoutFamily as parseLayoutFamilyValue } from "@/shared/api/enums";
import type { LayoutFamily } from "@/shared/api/enums";

export function normalizeName(name: string): string {
  return name.trim();
}

export function isNameValid(name: string): boolean {
  return normalizeName(name).length > 0;
}

export const defaultLayoutFamily: LayoutFamily = "momotetsu_2";

export function parseLayoutFamily(layoutFamily: string): LayoutFamily | undefined {
  return parseLayoutFamilyValue(layoutFamily);
}
