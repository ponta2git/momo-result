/** Keeps peer actions on the shared 8px rhythm while allowing narrow rows to wrap. */
export const actionRowClass = "flex w-full min-w-0 flex-wrap items-center gap-2";

/** Keeps a compact peer group intrinsic when it sits inside another layout owner. */
export const inlineActionGroupClass = "flex min-w-0 max-w-full flex-wrap items-center gap-2";

/** The final execution step shares one inset surface, without a second border. */
export const taskActionPanelClass =
  "grid min-w-0 gap-4 rounded-md bg-[var(--color-surface-subtle)] p-4";
