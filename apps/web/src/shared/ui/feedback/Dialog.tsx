import { AlertDialog as BaseAlertDialog } from "@base-ui/react/alert-dialog";
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import type { ReactElement, ReactNode } from "react";

import { IconButton } from "@/shared/ui/actions/IconButton";
import { cn } from "@/shared/ui/cn";

type DialogBaseProps = {
  children?: ReactNode | undefined;
  className?: string | undefined;
  description?: ReactNode | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
  open?: boolean | undefined;
  title: ReactNode;
  trigger: ReactElement;
};

type AlertDialogProps = DialogBaseProps & {
  cancelLabel?: ReactNode | undefined;
  confirmLabel?: ReactNode | undefined;
  onConfirm: () => void;
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
          <h2 className="text-lg font-semibold text-balance text-[var(--color-text-primary)]">
            {title}
          </h2>
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
  className,
  description,
  onOpenChange,
  open,
  title,
  trigger,
}: DialogBaseProps) {
  return (
    <BaseDialog.Root onOpenChange={(nextOpen) => onOpenChange?.(nextOpen)} open={open}>
      <BaseDialog.Trigger render={trigger} />
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="fixed inset-0 z-[var(--z-dialog)] bg-[var(--momo-night-900)]/35" />
        <BaseDialog.Popup
          className="fixed inset-0 z-[var(--z-dialog)] mx-auto flex w-full max-w-[40rem] items-center justify-center p-4"
          initialFocus={true}
        >
          <div className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-[var(--color-text-primary)] shadow-lg">
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
  confirmLabel = "実行",
  description,
  onConfirm,
  onOpenChange,
  open,
  title,
  trigger,
}: AlertDialogProps) {
  return (
    <BaseAlertDialog.Root onOpenChange={(nextOpen) => onOpenChange?.(nextOpen)} open={open}>
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
                      type="button"
                    />
                  }
                >
                  {cancelLabel}
                </BaseAlertDialog.Close>
                <BaseAlertDialog.Close
                  onClick={onConfirm}
                  render={
                    <button
                      className="inline-flex min-h-10 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-danger)] bg-[var(--color-danger)] px-4 py-2 text-sm font-semibold text-white"
                      type="button"
                    />
                  }
                >
                  {confirmLabel}
                </BaseAlertDialog.Close>
              </div>
            </div>
          </div>
        </BaseAlertDialog.Popup>
      </BaseAlertDialog.Portal>
    </BaseAlertDialog.Root>
  );
}
