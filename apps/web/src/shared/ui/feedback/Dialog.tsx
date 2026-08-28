import { AlertDialog as BaseAlertDialog } from "@base-ui/react/alert-dialog";
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { AnimatePresence, useReducedMotionConfig } from "motion/react";
import type { ReactElement, ReactNode } from "react";
import { useState } from "react";

import { AlertDialogLayer, DialogLayer } from "@/shared/ui/feedback/DialogLayer";

type DialogBaseProps = {
  backdropClassName?: string | undefined;
  children?: ReactNode | undefined;
  className?: string | undefined;
  description?: ReactNode | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
  open?: boolean | undefined;
  popupClassName?: string | undefined;
  surfaceClassName?: string | undefined;
  title: ReactNode;
};

type DialogProps = DialogBaseProps & {
  busy?: boolean | undefined;
  dismissible?: boolean | undefined;
  trigger?: ReactElement | undefined;
};

type AlertDialogProps = DialogBaseProps & {
  cancelLabel?: ReactNode | undefined;
  closeOnSuccess?: boolean | undefined;
  confirmDisabled?: boolean | undefined;
  confirmLabel?: ReactNode | undefined;
  formatError?: ((error: unknown) => string) | undefined;
  onConfirm: () => Promise<void> | void;
  pending?: boolean | undefined;
  tone?: "danger" | "primary" | undefined;
  trigger?: ReactElement | undefined;
};

/** Keeps action-bearing dialog forms in one reading order without moving them outside the form. */
export const dialogFooterClassName =
  "flex flex-wrap justify-end gap-2 border-t border-[var(--color-border)] pt-4";

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
  className,
  description,
  dismissible = true,
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
            className={className}
            description={description}
            dismissible={canDismiss}
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
  className,
  closeOnSuccess = true,
  confirmDisabled = false,
  confirmLabel = "実行",
  description,
  formatError = defaultAlertErrorMessage,
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
  const [internalPending, setInternalPending] = useState(false);
  const [internalError, setInternalError] = useState("");
  const controllableOpen = useControllableDialogOpen(open, onOpenChange);
  const { actualOpen } = controllableOpen;
  const actualPending = pending || internalPending;
  const reduceMotion = useReducedMotionConfig();
  const setOpen = (nextOpen: boolean) => {
    if (!nextOpen && actualPending) {
      return;
    }
    setInternalError("");
    controllableOpen.setOpen(nextOpen);
  };
  const handleConfirm = async () => {
    setInternalError("");
    setInternalPending(true);
    try {
      await onConfirm();
      if (closeOnSuccess) {
        setOpen(false);
      }
    } catch (error) {
      setInternalError(formatError(error));
    } finally {
      setInternalPending(false);
    }
  };

  return (
    <BaseAlertDialog.Root
      open={actualOpen}
      onOpenChange={(nextOpen, eventDetails) => {
        if (!nextOpen && actualPending) {
          eventDetails.cancel();
          return;
        }
        setOpen(nextOpen);
      }}
    >
      {trigger ? <BaseAlertDialog.Trigger render={trigger} /> : null}
      <AnimatePresence>
        {actualOpen ? (
          <AlertDialogLayer
            backdropClassName={backdropClassName}
            cancelLabel={cancelLabel}
            className={className}
            confirmDisabled={confirmDisabled}
            confirmLabel={confirmLabel}
            description={description}
            error={internalError}
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
