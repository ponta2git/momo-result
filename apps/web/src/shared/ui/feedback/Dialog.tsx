import { AlertDialog as BaseAlertDialog } from "@base-ui/react/alert-dialog";
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { LoaderCircle, X } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { useState } from "react";

import { buttonClassName } from "@/shared/ui/actions/Button";
import { IconButton } from "@/shared/ui/actions/IconButton";
import { cn } from "@/shared/ui/cn";

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

function defaultAlertErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "操作を完了できませんでした。時間をおいて、もう一度お試しください。";
}

function DialogContentFrame({
  children,
  className,
  description,
  dismissible = true,
  title,
}: Pick<DialogBaseProps, "children" | "className" | "description" | "title"> & {
  dismissible?: boolean | undefined;
}) {
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-3">
      <div className="flex shrink-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <BaseDialog.Title className="text-lg font-semibold text-balance text-[var(--color-text-primary)]">
            {title}
          </BaseDialog.Title>
          {description ? (
            <BaseDialog.Description className="mt-1 text-sm leading-6 text-pretty text-[var(--color-text-secondary)]">
              {description}
            </BaseDialog.Description>
          ) : null}
        </div>
        {dismissible ? (
          <BaseDialog.Close
            render={
              <IconButton aria-label="ダイアログを閉じる" icon={<X />} size="sm" variant="quiet" />
            }
          />
        ) : null}
      </div>
      <div className={cn("min-h-0 min-w-0 flex-1 overflow-y-auto px-2", className)}>{children}</div>
    </div>
  );
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

  return (
    <BaseDialog.Root
      onOpenChange={(nextOpen, eventDetails) => {
        if (!canDismiss && !nextOpen) {
          eventDetails.cancel();
          return;
        }
        onOpenChange?.(nextOpen);
      }}
      open={open}
    >
      {trigger ? <BaseDialog.Trigger render={trigger} /> : null}
      <BaseDialog.Portal>
        <BaseDialog.Backdrop
          className={cn(
            "fixed inset-0 z-[var(--z-dialog)] bg-[var(--momo-night-900)]/35",
            backdropClassName,
          )}
        />
        <BaseDialog.Popup
          className={cn(
            "momo-dialog-popup fixed inset-0 z-[var(--z-dialog)] mx-auto flex w-full max-w-[40rem] items-center justify-center overflow-hidden",
            popupClassName,
          )}
          initialFocus={true}
        >
          <div
            aria-busy={busy || undefined}
            className={cn(
              "momo-dialog-surface momo-enter flex w-full overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-[var(--color-text-primary)] shadow-[var(--shadow-dialog)]",
              surfaceClassName,
            )}
          >
            <DialogContentFrame
              className={className}
              description={description}
              dismissible={canDismiss}
              title={title}
            >
              {children}
            </DialogContentFrame>
          </div>
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}

export function AlertDialog({
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
  tone = "danger",
  title,
  trigger,
}: AlertDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [internalPending, setInternalPending] = useState(false);
  const [internalError, setInternalError] = useState("");
  const controlled = open !== undefined;
  const actualOpen = controlled ? open : internalOpen;
  const actualPending = pending || internalPending;
  const setOpen = (nextOpen: boolean) => {
    if (!nextOpen && actualPending) {
      return;
    }
    setInternalError("");
    if (!controlled) {
      setInternalOpen(nextOpen);
    }
    onOpenChange?.(nextOpen);
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
      <BaseAlertDialog.Portal>
        <BaseAlertDialog.Backdrop className="fixed inset-0 z-[var(--z-dialog)] bg-[var(--momo-night-900)]/35" />
        <BaseAlertDialog.Popup className="momo-dialog-popup fixed inset-0 z-[var(--z-dialog)] mx-auto flex w-full max-w-[40rem] items-center justify-center overflow-hidden">
          <div
            aria-busy={actualPending || undefined}
            className="momo-dialog-surface momo-enter w-full overflow-y-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-[var(--color-text-primary)] shadow-[var(--shadow-dialog)]"
          >
            <div className="space-y-3">
              <BaseAlertDialog.Title className="text-lg font-semibold text-balance text-[var(--color-text-primary)]">
                {title}
              </BaseAlertDialog.Title>
              {description ? (
                <BaseAlertDialog.Description className="text-sm leading-6 text-pretty text-[var(--color-text-secondary)]">
                  {description}
                </BaseAlertDialog.Description>
              ) : null}
              <div className={cn("min-w-0", className)}>{children}</div>
              {internalError ? (
                <p
                  className="rounded-[var(--radius-sm)] border border-[var(--color-danger)]/50 bg-[var(--color-danger)]/8 px-3 py-2 text-sm font-medium text-[var(--color-danger)]"
                  role="alert"
                >
                  {internalError}
                </p>
              ) : null}
              <div className="flex flex-wrap justify-end gap-2">
                <BaseAlertDialog.Close
                  render={
                    <button
                      aria-label={typeof cancelLabel === "string" ? cancelLabel : "キャンセル"}
                      className={buttonClassName({ variant: "secondary" })}
                      disabled={actualPending}
                      type="button"
                    />
                  }
                >
                  {cancelLabel}
                </BaseAlertDialog.Close>
                <button
                  aria-busy={actualPending}
                  className={buttonClassName({ variant: tone === "danger" ? "danger" : "primary" })}
                  disabled={actualPending || confirmDisabled}
                  type="button"
                  onClick={handleConfirm}
                >
                  {actualPending ? (
                    <LoaderCircle
                      aria-hidden="true"
                      className="size-4 animate-spin motion-reduce:animate-none"
                    />
                  ) : null}
                  <span>{confirmLabel}</span>
                </button>
              </div>
            </div>
          </div>
        </BaseAlertDialog.Popup>
      </BaseAlertDialog.Portal>
    </BaseAlertDialog.Root>
  );
}
