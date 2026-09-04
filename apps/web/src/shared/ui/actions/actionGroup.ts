import { cn } from "@/shared/ui/cn";

/** Keeps peer actions on the shared 8px rhythm while allowing narrow rows to wrap. */
export const actionRowClass = "flex w-full min-w-0 flex-wrap items-center gap-2";

/** Keeps a compact peer group intrinsic when it sits inside another layout owner. */
export const inlineActionGroupClass = "flex min-w-0 flex-wrap items-center gap-2";

/** Gives two or more peer actions predictable mobile width before labels fit inline. */
export const responsiveActionGroupClass =
  "grid w-full shrink-0 grid-cols-2 gap-2 sm:flex sm:w-auto sm:items-center";

/** Gives a mobile action group one full-width lead action before compact peers. */
export const responsiveLeadActionGroupClass = cn(
  responsiveActionGroupClass,
  "[&>*:first-child]:col-span-2 sm:[&>*:first-child]:col-auto",
);
