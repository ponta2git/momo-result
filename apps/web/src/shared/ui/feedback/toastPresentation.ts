export const toastToneClass: Record<string, string> = {
  danger: "border-[var(--color-danger)]/60 bg-[var(--color-surface)]",
  info: "border-[var(--color-border-strong)] bg-[var(--color-surface)]",
  success: "border-[var(--color-success)]/60 bg-[var(--color-surface)]",
  warning: "border-[var(--color-warning)]/80 bg-[var(--color-surface)]",
};

export const toastViewportClassName =
  "momo-toast-viewport fixed z-[var(--z-toast)] flex flex-col gap-2";
