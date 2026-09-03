import { AlertDialog as BaseAlertDialog } from "@base-ui/react/alert-dialog";
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import { m, useIsPresent } from "motion/react";
import type { ReactNode } from "react";

import { Button } from "@/shared/ui/actions/Button";
import { IconButton } from "@/shared/ui/actions/IconButton";
import { cn } from "@/shared/ui/cn";
import { instantMotionTransition, politeMotionTransition } from "@/shared/ui/motion/transitions";

const dialogBackdropClassName = "fixed inset-0 z-[var(--z-dialog)] bg-[var(--color-backdrop)]/35";
const dialogPopupClassName =
  "momo-dialog-popup fixed inset-0 z-[var(--z-dialog)] mx-auto flex w-full max-w-[40rem] items-center justify-center overflow-hidden";
const dialogSurfaceClassName =
  "momo-dialog-surface w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-[var(--color-text-primary)] shadow-[var(--shadow-dialog)]";
const dialogBackdropInitial = { opacity: 0 } as const;
const dialogSurfaceInitial = { opacity: 0.96 } as const;
const dialogHidden = { opacity: 0 } as const;
const dialogVisible = { opacity: 1 } as const;

type SharedLayerProps = {
  backdropClassName?: string | undefined;
  children?: ReactNode | undefined;
  contentClassName?: string | undefined;
  description?: ReactNode | undefined;
  popupClassName?: string | undefined;
  reduceMotion: boolean | null;
  surfaceClassName?: string | undefined;
  title: ReactNode;
};

export type DialogLayerProps = SharedLayerProps & {
  busy: boolean;
  dismissible: boolean;
};

function DialogContentFrame({
  children,
  contentClassName,
  description,
  dismissible,
  title,
}: Pick<SharedLayerProps, "children" | "contentClassName" | "description" | "title"> & {
  dismissible: boolean;
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
      <div className={cn("min-h-0 min-w-0 flex-1 overflow-y-auto px-2", contentClassName)}>
        {children}
      </div>
    </div>
  );
}

/** Keeps the visual exit mounted without retaining dialog semantics or interaction. */
export function DialogLayer({
  backdropClassName,
  busy,
  children,
  contentClassName,
  description,
  dismissible,
  popupClassName,
  reduceMotion,
  surfaceClassName,
  title,
}: DialogLayerProps) {
  const isPresent = useIsPresent();
  const transition = reduceMotion ? instantMotionTransition : politeMotionTransition;
  const exitSnapshotProps = isPresent ? {} : ({ "aria-hidden": true, inert: true } as const);

  return (
    <BaseDialog.Portal keepMounted>
      <BaseDialog.Backdrop
        className={cn(
          dialogBackdropClassName,
          !isPresent && "pointer-events-none",
          backdropClassName,
        )}
        data-exit-snapshot={isPresent ? undefined : ""}
        render={
          <m.div
            animate={dialogVisible}
            exit={dialogHidden}
            initial={reduceMotion ? false : dialogBackdropInitial}
            transition={transition}
          />
        }
      />
      <BaseDialog.Popup
        {...exitSnapshotProps}
        className={cn(dialogPopupClassName, !isPresent && "pointer-events-none", popupClassName)}
        data-exit-snapshot={isPresent ? undefined : ""}
        initialFocus={true}
        render={
          <m.div
            animate={dialogVisible}
            exit={dialogHidden}
            initial={reduceMotion ? false : dialogSurfaceInitial}
            transition={transition}
          />
        }
      >
        <div
          aria-busy={busy || undefined}
          className={cn(dialogSurfaceClassName, "flex overflow-hidden", surfaceClassName)}
        >
          <DialogContentFrame
            contentClassName={contentClassName}
            description={description}
            dismissible={dismissible}
            title={title}
          >
            {children}
          </DialogContentFrame>
        </div>
      </BaseDialog.Popup>
    </BaseDialog.Portal>
  );
}

export type AlertDialogLayerProps = SharedLayerProps & {
  cancelLabel: ReactNode;
  confirmDisabled: boolean;
  confirmLabel: ReactNode;
  error: string;
  onConfirm: () => void;
  pending: boolean;
  tone: "danger" | "primary";
};

/** AlertDialog's visual layer shares the same non-interactive exit contract as DialogLayer. */
export function AlertDialogLayer({
  backdropClassName,
  cancelLabel,
  children,
  contentClassName,
  confirmDisabled,
  confirmLabel,
  description,
  error,
  onConfirm,
  pending,
  popupClassName,
  reduceMotion,
  surfaceClassName,
  title,
  tone,
}: AlertDialogLayerProps) {
  const isPresent = useIsPresent();
  const transition = reduceMotion ? instantMotionTransition : politeMotionTransition;
  const exitSnapshotProps = isPresent ? {} : ({ "aria-hidden": true, inert: true } as const);

  return (
    <BaseAlertDialog.Portal keepMounted>
      <BaseAlertDialog.Backdrop
        className={cn(
          dialogBackdropClassName,
          !isPresent && "pointer-events-none",
          backdropClassName,
        )}
        data-exit-snapshot={isPresent ? undefined : ""}
        render={
          <m.div
            animate={dialogVisible}
            exit={dialogHidden}
            initial={reduceMotion ? false : dialogBackdropInitial}
            transition={transition}
          />
        }
      />
      <BaseAlertDialog.Popup
        {...exitSnapshotProps}
        className={cn(dialogPopupClassName, !isPresent && "pointer-events-none", popupClassName)}
        data-exit-snapshot={isPresent ? undefined : ""}
        render={
          <m.div
            animate={dialogVisible}
            exit={dialogHidden}
            initial={reduceMotion ? false : dialogSurfaceInitial}
            transition={transition}
          />
        }
      >
        <div
          aria-busy={pending || undefined}
          className={cn(dialogSurfaceClassName, "overflow-y-auto", surfaceClassName)}
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
            <div className={cn("min-w-0", contentClassName)}>{children}</div>
            {error ? (
              <p
                className="rounded-xs border border-[var(--color-danger)]/50 bg-[var(--color-danger)]/8 px-3 py-2 text-sm font-medium text-[var(--color-danger)]"
                role="alert"
              >
                {error}
              </p>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2">
              <BaseAlertDialog.Close
                render={
                  <Button
                    aria-label={typeof cancelLabel === "string" ? cancelLabel : "キャンセル"}
                    disabled={pending}
                    variant="secondary"
                  >
                    {cancelLabel}
                  </Button>
                }
              />
              <Button
                disabled={confirmDisabled}
                pending={pending}
                pendingLabel={confirmLabel}
                variant={tone === "danger" ? "danger" : "primary"}
                onClick={onConfirm}
              >
                {confirmLabel}
              </Button>
            </div>
          </div>
        </div>
      </BaseAlertDialog.Popup>
    </BaseAlertDialog.Portal>
  );
}
