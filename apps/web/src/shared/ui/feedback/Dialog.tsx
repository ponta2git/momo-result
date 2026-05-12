import { AlertDialog as BaseAlertDialog } from "@base-ui/react/alert-dialog";
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { useState } from "react";

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
  trigger?: ReactElement | undefined;
};

type AlertDialogProps = DialogBaseProps & {
  cancelLabel?: ReactNode | undefined;
  closeOnSuccess?: boolean | undefined;
  confirmDisabled?: boolean | undefined;
  confirmLabel?: ReactNode | undefined;
  onConfirm: () => Promise<void> | void;
  pending?: boolean | undefined;
  trigger: ReactElement;
};

function DialogContentFrame({
  children,
  className,
  description,
  title,
}: Pick<DialogBaseProps, "children" | "className" | "description" | "title">) {
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <BaseDialog.Title className="text-lg font-semibold text-balance text-[var(--color-text-primary)]">
            {title}
          </BaseDialog.Title>
          {description ? (
            <p className="mt-1 text-sm leading-6 text-pretty text-[var(--color-text-secondary)]">
              {description}
            </p>
          ) : null}
        </div>
        <BaseDialog.Close
          render={
            <IconButton aria-label="ダイアログを閉じる" icon={<X />} size="sm" variant="quiet" />
          }
        />
      </div>
      <div className={cn("min-w-0", className)}>{children}</div>
    </div>
  );
}

export function Dialog({
  children,
  backdropClassName,
  className,
  description,
  onOpenChange,
  open,
  popupClassName,
  surfaceClassName,
  title,
  trigger,
}: DialogProps) {
  return (
    <BaseDialog.Root onOpenChange={(nextOpen) => onOpenChange?.(nextOpen)} open={open}>
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
            "fixed inset-0 z-[var(--z-dialog)] mx-auto flex w-full max-w-[40rem] items-center justify-center p-4",
            popupClassName,
          )}
          initialFocus={true}
        >
          <div
            className={cn(
              "w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-[var(--color-text-primary)] shadow-lg",
              surfaceClassName,
            )}
          >
            <DialogContentFrame className={className} description={description} title={title}>
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
  onConfirm,
  onOpenChange,
  open,
  pending = false,
  title,
  trigger,
}: AlertDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [internalPending, setInternalPending] = useState(false);
  const controlled = open !== undefined;
  const actualOpen = controlled ? open : internalOpen;
  const actualPending = pending || internalPending;
  const setOpen = (nextOpen: boolean) => {
    if (!controlled) {
      setInternalOpen(nextOpen);
    }
    onOpenChange?.(nextOpen);
  };
  const handleConfirm = async () => {
    setInternalPending(true);
    try {
      await onConfirm();
      if (closeOnSuccess) {
        setOpen(false);
      }
    } catch {
      // Keep the dialog open. Callers surface operation errors in their own UI.
    } finally {
      setInternalPending(false);
    }
  };

  return (
    <BaseAlertDialog.Root onOpenChange={setOpen} open={actualOpen}>
      <BaseAlertDialog.Trigger render={trigger} />
      <BaseAlertDialog.Portal>
        <BaseAlertDialog.Backdrop className="fixed inset-0 z-[var(--z-dialog)] bg-[var(--momo-night-900)]/35" />
        <BaseAlertDialog.Popup className="fixed inset-0 z-[var(--z-dialog)] mx-auto flex w-full max-w-[40rem] items-center justify-center p-4">
          <div className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-[var(--color-text-primary)] shadow-lg">
            <div className="space-y-3">
              <h2 className="text-lg font-semibold text-balance text-[var(--color-text-primary)]">
                {title}
              </h2>
              {description ? (
                <p className="text-sm leading-6 text-pretty text-[var(--color-text-secondary)]">
                  {description}
                </p>
              ) : null}
              <div className={cn("min-w-0", className)}>{children}</div>
              <div className="flex flex-wrap justify-end gap-2">
                <BaseAlertDialog.Close
                  render={
                    <button
                      className="inline-flex min-h-10 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-sm font-semibold text-[var(--color-text-primary)]"
                      disabled={actualPending}
                      type="button"
                    />
                  }
                >
                  {cancelLabel}
                </BaseAlertDialog.Close>
                <button
                  aria-busy={actualPending}
                  className="inline-flex min-h-10 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-danger)] bg-[var(--color-danger)] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={actualPending || confirmDisabled}
                  type="button"
                  onClick={handleConfirm}
                >
                  {confirmLabel}
                </button>
              </div>
            </div>
          </div>
        </BaseAlertDialog.Popup>
      </BaseAlertDialog.Portal>
    </BaseAlertDialog.Root>
  );
}
