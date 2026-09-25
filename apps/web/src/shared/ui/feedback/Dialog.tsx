import { AlertDialog as BaseAlertDialog } from "@base-ui/react/alert-dialog";
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { AnimatePresence, useReducedMotionConfig } from "motion/react";
import type { HTMLAttributes, ReactElement, ReactNode } from "react";
import { useLayoutEffect, useRef, useState } from "react";

import { AlertDialogLayer, DialogLayer } from "@/shared/ui/feedback/DialogLayer";
import type { AlertDialogLayerProps } from "@/shared/ui/feedback/DialogLayer";

type DialogBaseProps = {
  backdropClassName?: string | undefined;
  children?: ReactNode | undefined;
  contentClassName?: string | undefined;
  description?: ReactNode | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
  open?: boolean | undefined;
  popupClassName?: string | undefined;
  surfaceClassName?: string | undefined;
  title: ReactNode;
};

type DialogProps = DialogBaseProps & {
  headerStatus?: ReactNode | undefined;
  busy?: boolean | undefined;
  dismissible?: boolean | undefined;
  trigger?: ReactElement | undefined;
};

type AlertDialogProps = DialogBaseProps & {
  finalFocus?: AlertDialogLayerProps["finalFocus"];
  cancelLabel?: ReactNode | undefined;
  closeOnSuccess?: boolean | undefined;
  confirmDisabled?: boolean | undefined;
  confirmLabel?: ReactNode | undefined;
  pendingLabel?: ReactNode | undefined;
  formatError?: ((error: unknown) => string) | undefined;
  onConfirm: () => Promise<void> | void;
  pending?: boolean | undefined;
  tone?: "danger" | "primary" | undefined;
  trigger?: ReactElement | undefined;
};

/** Owns the internal boundary and action order of an action-bearing dialog form. */
export function DialogFooter({
  ...props
}: Omit<HTMLAttributes<HTMLDivElement>, "className" | "style">) {
  return (
    <div
      className="flex flex-wrap justify-end gap-2 border-t border-[var(--color-border)] pt-4"
      {...props}
    />
  );
}

function useControllableDialogOpen(
  open: boolean | undefined,
  onOpenChange: ((open: boolean) => void) | undefined,
) {
  const [internalOpen, setInternalOpen] = useState(false);
  const controlled = open !== undefined;
  const actualOpen = controlled ? open : internalOpen;

  return {
    actualOpen,
    setOpen(nextOpen: boolean) {
      if (!controlled) {
        setInternalOpen(nextOpen);
      }
      onOpenChange?.(nextOpen);
    },
  };
}

function defaultAlertErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "操作を完了できませんでした。時間をおいて、もう一度お試しください。";
}

export function Dialog({
  busy = false,
  children,
  backdropClassName,
  contentClassName,
  description,
  dismissible = true,
  headerStatus,
  onOpenChange,
  open,
  popupClassName,
  surfaceClassName,
  title,
  trigger,
}: DialogProps) {
  const canDismiss = dismissible && !busy;
  const reduceMotion = useReducedMotionConfig();
  const { actualOpen, setOpen } = useControllableDialogOpen(open, onOpenChange);

  return (
    <BaseDialog.Root
      open={actualOpen}
      onOpenChange={(nextOpen, eventDetails) => {
        if (!canDismiss && !nextOpen) {
          eventDetails.cancel();
          return;
        }
        setOpen(nextOpen);
      }}
    >
      {trigger ? <BaseDialog.Trigger render={trigger} /> : null}
      <AnimatePresence>
        {actualOpen ? (
          <DialogLayer
            backdropClassName={backdropClassName}
            busy={busy}
            contentClassName={contentClassName}
            description={description}
            dismissible={canDismiss}
            headerStatus={headerStatus}
            key="dialog-layer"
            popupClassName={popupClassName}
            reduceMotion={reduceMotion}
            surfaceClassName={surfaceClassName}
            title={title}
          >
            {children}
          </DialogLayer>
        ) : null}
      </AnimatePresence>
    </BaseDialog.Root>
  );
}

export function AlertDialog({
  backdropClassName,
  cancelLabel = "キャンセル",
  children,
  contentClassName,
  closeOnSuccess = true,
  confirmDisabled = false,
  confirmLabel = "実行",
  pendingLabel = confirmLabel,
  description,
  formatError = defaultAlertErrorMessage,
  finalFocus,
  onConfirm,
  onOpenChange,
  open,
  pending = false,
  popupClassName,
  surfaceClassName,
  tone = "danger",
  title,
  trigger,
}: AlertDialogProps) {
  const controllableOpen = useControllableDialogOpen(open, onOpenChange);
  const { actualOpen } = controllableOpen;
  const [confirmation, setConfirmation] = useState({
    open: actualOpen,
    pending: false,
    error: "",
  });
  const activeAttempt = useRef<symbol | null>(null);
  // A controlled owner may close or replace this task while its request is unresolved.
  // Its next opening must start clean, and the old request must not close the new task.
  if (confirmation.open !== actualOpen) {
    setConfirmation({ open: actualOpen, pending: false, error: "" });
  }
  useLayoutEffect(() => {
    if (!actualOpen) activeAttempt.current = null;
    return () => {
      activeAttempt.current = null;
    };
  }, [actualOpen]);
  const actualPending = pending || confirmation.pending;
  const reduceMotion = useReducedMotionConfig();
  const handleConfirm = async () => {
    if (!actualOpen || actualPending || confirmDisabled || activeAttempt.current) return;
    const attempt = Symbol("confirmation");
    activeAttempt.current = attempt;
    setConfirmation({ open: actualOpen, pending: true, error: "" });
    try {
      await onConfirm();
      if (activeAttempt.current !== attempt) return;
      setConfirmation({ open: actualOpen, pending: false, error: "" });
      if (closeOnSuccess) {
        controllableOpen.setOpen(false);
      }
    } catch (error) {
      if (activeAttempt.current !== attempt) return;
      setConfirmation({ open: actualOpen, pending: false, error: formatError(error) });
    } finally {
      if (activeAttempt.current === attempt) activeAttempt.current = null;
    }
  };

  return (
    <BaseAlertDialog.Root
      open={actualOpen}
      onOpenChange={(nextOpen, eventDetails) => {
        if (!nextOpen && (actualPending || activeAttempt.current)) {
          eventDetails.cancel();
          return;
        }
        controllableOpen.setOpen(nextOpen);
      }}
    >
      {trigger ? <BaseAlertDialog.Trigger render={trigger} /> : null}
      <AnimatePresence>
        {actualOpen ? (
          <AlertDialogLayer
            backdropClassName={backdropClassName}
            cancelLabel={cancelLabel}
            contentClassName={contentClassName}
            confirmDisabled={confirmDisabled}
            confirmLabel={confirmLabel}
            pendingLabel={pendingLabel}
            description={description}
            error={confirmation.error}
            finalFocus={finalFocus}
            key="alert-dialog-layer"
            pending={actualPending}
            popupClassName={popupClassName}
            reduceMotion={reduceMotion}
            surfaceClassName={surfaceClassName}
            title={title}
            tone={tone}
            onConfirm={() => void handleConfirm()}
          >
            {children}
          </AlertDialogLayer>
        ) : null}
      </AnimatePresence>
    </BaseAlertDialog.Root>
  );
}
