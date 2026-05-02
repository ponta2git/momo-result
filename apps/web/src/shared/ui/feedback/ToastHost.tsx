import { Toast } from "@base-ui/react/toast";

import { IconButton } from "@/shared/ui/actions/IconButton";
import { cn } from "@/shared/ui/cn";
import { momoToastManager } from "@/shared/ui/feedback/Toast";

const toneClass: Record<string, string> = {
  danger: "border-[var(--color-danger)]/60 bg-[var(--color-surface)]",
  info: "border-[var(--color-border-strong)] bg-[var(--color-surface)]",
  success: "border-[var(--color-success)]/60 bg-[var(--color-surface)]",
  warning: "border-[var(--color-warning)]/80 bg-[var(--color-surface)]",
};

export function ToastHost() {
  return (
    <Toast.Provider limit={4} toastManager={momoToastManager} timeout={4500}>
      <ToastRenderer />
    </Toast.Provider>
  );
}

function ToastRenderer() {
  const { toasts } = Toast.useToastManager();

  return (
    <Toast.Portal>
      <Toast.Viewport
        aria-live="polite"
        className="momo-safe-right momo-safe-bottom fixed z-[var(--z-toast)] flex w-[min(24rem,calc(100vw-1rem))] flex-col gap-2 p-2"
      >
        {toasts.map((toast) => (
          <Toast.Root
            key={toast.id}
            className={cn(
              "rounded-[var(--radius-lg)] border p-3 shadow-sm",
              toneClass[toast.type ?? "info"] ?? toneClass.info,
            )}
            toast={toast}
          >
            <Toast.Content>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <Toast.Title className="text-sm font-semibold text-[var(--color-text-primary)]" />
                  <Toast.Description className="mt-0.5 text-xs leading-5 text-[var(--color-text-secondary)]" />
                </div>
                <Toast.Close
                  aria-label="通知を閉じる"
                  render={
                    <IconButton aria-label="通知を閉じる" icon="×" size="sm" variant="quiet" />
                  }
                />
              </div>
            </Toast.Content>
          </Toast.Root>
        ))}
      </Toast.Viewport>
    </Toast.Portal>
  );
}
