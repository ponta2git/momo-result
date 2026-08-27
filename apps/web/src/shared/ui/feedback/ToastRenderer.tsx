import { Toast } from "@base-ui/react/toast";
import { m, useReducedMotionConfig } from "motion/react";

import { IconButton } from "@/shared/ui/actions/IconButton";
import { cn } from "@/shared/ui/cn";
import { toastToneClass, toastViewportClassName } from "@/shared/ui/feedback/toastPresentation";
import { instantMotionTransition, politeMotionTransition } from "@/shared/ui/motion/transitions";

export function ToastRenderer() {
  const { toasts } = Toast.useToastManager();
  const reduceMotion = useReducedMotionConfig();

  return (
    <Toast.Portal>
      <Toast.Viewport aria-live="polite" className={toastViewportClassName}>
        {toasts.map((toast) => (
          <div key={toast.id}>
            <Toast.Root
              className={cn(
                "rounded-[var(--radius-lg)] border p-3 shadow-[var(--shadow-raised)]",
                toastToneClass[toast.type ?? "info"] ?? toastToneClass["info"],
              )}
              render={
                <m.div
                  animate={{ opacity: toast.transitionStatus === "ending" ? 0 : 1 }}
                  initial={reduceMotion ? false : { opacity: 0 }}
                  transition={reduceMotion ? instantMotionTransition : politeMotionTransition}
                />
              }
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
          </div>
        ))}
      </Toast.Viewport>
    </Toast.Portal>
  );
}
