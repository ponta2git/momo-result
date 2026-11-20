import type { ClassValue } from "clsx";
import { clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      container: ["readable", "page-default", "page-analysis", "page-workspace"],
      "font-weight": ["plain", "structure", "emphasis"],
      shadow: ["raised", "dialog"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
