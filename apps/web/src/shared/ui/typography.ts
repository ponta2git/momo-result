/**
 * Reading-oriented content uses three sizes; headings retain their semantic HTML level.
 * Each role owns size, line height, weight, and color as one recipe. Choose the role
 * from the task, rather than overriding individual properties at the call site.
 */
export const contentText = {
  primary: "text-xl/7 font-emphasis text-[var(--color-text-primary)]",
  // Dense lists and repeated result rows keep their main result at body size.
  compactPrimary: "text-sm/5 font-emphasis text-[var(--color-text-primary)]",
  heading: "text-sm/5 font-structure text-[var(--color-text-primary)]",
  body: "text-sm/5 font-plain text-[var(--color-text-body)]",
  supporting: "text-xs/4 font-plain text-[var(--color-text-muted)]",
} as const;

/** Field labels and validation remain readable while users operate a control. */
export const fieldText = {
  label: "text-sm/5 font-plain text-[var(--color-text-primary)]",
  description: contentText.supporting,
  error: "text-sm/5 font-plain text-[var(--color-danger)]",
} as const;
