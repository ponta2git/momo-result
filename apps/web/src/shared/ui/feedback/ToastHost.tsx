import { Toast } from "@base-ui/react/toast";
import { Component, lazy, Suspense } from "react";
import type { ReactNode } from "react";

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
        <Suspense fallback={null}>
          <ToastRenderer />
        </Suspense>
      </ToastRendererBoundary>
    </Toast.Provider>
  );
}

function ToastRendererFallback() {
  const { toasts } = Toast.useToastManager();

  return (
    <div
      aria-label="Notifications"
      aria-live="polite"
      className={toastViewportClassName}
      role="region"
    >
      {toasts.map((toast) => (
        <div
          className={cn(
            "rounded-[var(--radius-lg)] border p-3 shadow-[var(--shadow-raised)]",
            toastToneClass[toast.type ?? "info"] ?? toastToneClass["info"],
          )}
          key={toast.id}
        >
          <p className="text-sm font-semibold text-[var(--color-text-primary)]">{toast.title}</p>
          {toast.description ? (
            <p className="mt-0.5 text-xs leading-5 text-[var(--color-text-secondary)]">
              {toast.description}
            </p>
          ) : null}
        </div>
      ))}
    </div>
  );
}
