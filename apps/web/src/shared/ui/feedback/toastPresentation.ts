export const toastToneClass: Record<string, string> = {
  danger: "border-[var(--color-tone-danger-border)] bg-[var(--color-surface)]",
  info: "border-[var(--color-border)] bg-[var(--color-surface)]",
  success: "border-[var(--color-tone-success-border)] bg-[var(--color-surface)]",
  warning: "border-[var(--color-tone-warning-border)] bg-[var(--color-surface)]",
};

export const toastViewportClassName =
  "momo-toast-viewport fixed z-[var(--z-toast)] flex flex-col gap-2";
