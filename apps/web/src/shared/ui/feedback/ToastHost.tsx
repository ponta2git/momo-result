import { Toast } from "@base-ui/react/toast";
import { Component, lazy, Suspense } from "react";
import type { ReactNode } from "react";

import { IconButton } from "@/shared/ui/actions/IconButton";
import { cn } from "@/shared/ui/cn";
import { momoToastManager } from "@/shared/ui/feedback/Toast";
import { toastToneClass, toastViewportClassName } from "@/shared/ui/feedback/toastPresentation";

const ToastRenderer = lazy(async () => {
  const module = await import("@/shared/ui/feedback/ToastRenderer");
  return { default: module.ToastRenderer };
});

type ToastRendererBoundaryState = {
  failed: boolean;
};

class ToastRendererBoundary extends Component<{ children: ReactNode }, ToastRendererBoundaryState> {
  override state: ToastRendererBoundaryState = { failed: false };

  static getDerivedStateFromError(): ToastRendererBoundaryState {
    return { failed: true };
  }

  override render() {
    return this.state.failed ? <ToastRendererFallback /> : this.props.children;
  }
}

export function ToastHost() {
  return (
    <Toast.Provider limit={4} toastManager={momoToastManager} timeout={4500}>
      <ToastRendererBoundary>
        <Suspense fallback={<ToastRendererFallback />}>
          <ToastRenderer />
        </Suspense>
      </ToastRendererBoundary>
    </Toast.Provider>
  );
}

function ToastRendererFallback() {
  const { toasts } = Toast.useToastManager();

  return (
    <Toast.Portal>
      <Toast.Viewport
        aria-label="Notifications"
        aria-live="polite"
        className={toastViewportClassName}
      >
        {toasts.map((toast) => (
          <Toast.Root
            inert={toast.limited || toast.transitionStatus === "ending" || undefined}
            aria-hidden={toast.limited || toast.transitionStatus === "ending" || undefined}
            className={cn(
              "rounded-lg border p-3 shadow-[var(--shadow-raised)]",
              toast.limited && "hidden",
              toastToneClass[toast.type ?? "info"] ?? toastToneClass["info"],
            )}
            key={toast.id}
            toast={toast}
          >
            <Toast.Content className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <Toast.Title className="font-structure text-sm text-[var(--color-text-primary)]" />
                <Toast.Description className="mt-0.5 text-xs leading-5 text-[var(--color-text-secondary)]" />
              </div>
              <Toast.Close
                aria-label="通知を閉じる"
                render={<IconButton aria-label="通知を閉じる" icon="×" size="sm" variant="quiet" />}
              />
            </Toast.Content>
          </Toast.Root>
        ))}
      </Toast.Viewport>
    </Toast.Portal>
  );
}
