import { Toast } from "@base-ui/react/toast";
import { AnimatePresence, m, useIsPresent, useReducedMotionConfig } from "motion/react";

import { IconButton } from "@/shared/ui/actions/IconButton";
import { cn } from "@/shared/ui/cn";
import { toastToneClass, toastViewportClassName } from "@/shared/ui/feedback/toastPresentation";
import { instantMotionTransition, politeMotionTransition } from "@/shared/ui/motion/transitions";

const toastVisible = { opacity: 1 } as const;
const toastHidden = { opacity: 0 } as const;
type ToastItem = ReturnType<typeof Toast.useToastManager>["toasts"][number];

function PresentToast({ reduceMotion, toast }: { reduceMotion: boolean | null; toast: ToastItem }) {
  const isPresent = useIsPresent();

  return (
    <m.div
      aria-hidden={isPresent ? undefined : true}
      className={cn("w-full", !isPresent && "pointer-events-none")}
      data-toast-exit-snapshot={isPresent ? undefined : ""}
      exit={toastHidden}
      inert={isPresent ? undefined : true}
      initial={reduceMotion ? false : toastHidden}
      animate={toastVisible}
      transition={reduceMotion ? instantMotionTransition : politeMotionTransition}
    >
      <Toast.Root
        className={cn(
          "rounded-lg border p-3 shadow-[var(--shadow-raised)]",
          toastToneClass[toast.type ?? "info"] ?? toastToneClass["info"],
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
              render={<IconButton aria-label="通知を閉じる" icon="×" size="sm" variant="quiet" />}
            />
          </div>
        </Toast.Content>
      </Toast.Root>
    </m.div>
  );
}

export function ToastRenderer() {
  const { toasts } = Toast.useToastManager();
  const reduceMotion = useReducedMotionConfig();

  return (
    <Toast.Portal>
      <Toast.Viewport aria-live="polite" className={toastViewportClassName}>
        <AnimatePresence initial={false}>
          {toasts.map((toast) => (
            <PresentToast key={toast.id} reduceMotion={reduceMotion} toast={toast} />
          ))}
        </AnimatePresence>
      </Toast.Viewport>
    </Toast.Portal>
  );
}
