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

/**
 * A milestone moment (UI rule: 節目の演出) raises the celebrated result to the 24/30px step.
 * Use it only while the moment is shown; the same value reads as `contentText.primary` elsewhere.
 */
export const momentText = {
  result: "text-2xl/8 font-emphasis text-[var(--color-text-primary)] sm:text-3xl/9",
} as const;

/**
 * Field labels and validation remain readable while users operate a control. Field, fieldset,
 * and custom inputs share this recipe; small metadata text never stands in for a label or error.
 */
export const fieldText = {
  label: "text-sm/5 font-plain text-[var(--color-text-primary)]",
  description: contentText.supporting,
  error: "text-sm/5 font-plain text-[var(--color-danger)]",
} as const;
