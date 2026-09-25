import { Pencil, Trash2 } from "lucide-react";
import { startTransition, useRef, useState } from "react";

import { MasterResourceRefreshNotice } from "@/features/masters/MasterResourceRefreshNotice";
import type { MemberAliasResponse } from "@/shared/api/masters";
import { formatApiError } from "@/shared/api/problemDetails";
import { canonicalResultMembers, memberDisplayName } from "@/shared/domain/members";
import { MemberSequenceLabel } from "@/shared/matches/MemberSequenceLabel";
import { Button } from "@/shared/ui/actions/Button";
import { IconButton } from "@/shared/ui/actions/IconButton";
import { cn } from "@/shared/ui/cn";
import { AlertDialog, Dialog } from "@/shared/ui/feedback/Dialog";
import { SelectField } from "@/shared/ui/forms/SelectField";
import { TextField } from "@/shared/ui/forms/TextField";
import { contentText } from "@/shared/ui/typography";

type MemberAliasPanelProps = {
  completion?: string | undefined;
  aliases: MemberAliasResponse[];
  createAction: (formData: FormData) => void | Promise<void>;
  createError?: string | undefined;
  createFormKey?: string | number | undefined;
  createPending?: boolean | undefined;
  onDelete: (id: string) => Promise<void> | void;
  onRetry: () => void;
  onUpdate: (id: string, request: { memberId: string; alias: string }) => Promise<void>;
  refreshing: boolean;
  stale: boolean;
};

export function MemberAliasPanel({
  completion,
  aliases,
  createAction,
  createError,
  createFormKey,
  createPending = false,
  onDelete,
  onRetry,
  onUpdate,
  refreshing,
  stale,
}: MemberAliasPanelProps) {
  const aliasesByMember = canonicalResultMembers.map((member) => ({
    member,
    aliases: aliases.filter((alias) => alias.memberId === member.memberId),
  }));

  return (
    <section className="grid min-w-0 gap-4">
      <header>
        <h2 className={contentText.heading}>プレーヤー名の別名</h2>
        <p className={cn(contentText.body, "mt-1")}>
          画像から読み取られる表記を正式なプレーヤー名に紐づけます。
        </p>
      </header>

      <div className="empty:hidden">
        <MasterResourceRefreshNotice
          onRetry={onRetry}
          resourceLabel="別名"
          retrying={refreshing}
          stale={stale}
        />
      </div>

      <p className={contentText.supporting} role="status">
        {completion}
      </p>
      <form
        className="grid gap-x-4 gap-y-4 md:grid-cols-[minmax(12rem,0.35fr)_minmax(12rem,1fr)_auto] md:grid-rows-[auto_auto_auto] md:gap-y-0 md:[&>[data-field-root]]:row-span-3"
        key={createFormKey}
        onSubmit={(event) => {
          event.preventDefault();
          if (createPending) return;
          const data = new FormData(event.currentTarget);
          startTransition(() => createAction(data));
        }}
      >
        <SelectField
          disabled={createPending}
          label="プレーヤー"
          layout="subgrid"
          name="memberId"
          defaultValue={canonicalResultMembers[0]?.memberId ?? ""}
          options={canonicalResultMembers.map((member) => ({
            label: member.displayName,
            value: member.memberId,
          }))}
        />
        <TextField
          disabled={createPending}
          error={createError}
          label="別名"
          layout="subgrid"
          name="alias"
          placeholder="例: NO11社長"
          required
        />
        <div className="grid md:col-start-3 md:row-start-2">
          <Button pending={createPending} pendingLabel="追加中" type="submit" variant="secondary">
            追加
          </Button>
        </div>
      </form>

      <div className="grid gap-x-4 gap-y-6 md:grid-cols-2 xl:grid-cols-4">
        {aliasesByMember.map(({ member, aliases: memberAliases }) => (
          <div className="min-w-0" key={member.memberId}>
            <h3 className={cn(contentText.heading, "min-w-0")}>
              <MemberSequenceLabel memberId={member.memberId}>
                <span className="truncate">{member.displayName}</span>
              </MemberSequenceLabel>
            </h3>
            {memberAliases.length === 0 ? (
              <p className={cn(contentText.supporting, "mt-2")}>別名なし</p>
            ) : (
              <ul className="mt-2 divide-y divide-[var(--color-border)]">
                {memberAliases.map((alias) => (
                  <li
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 py-2"
                    key={alias.id}
                  >
                    <span className={cn(contentText.body, "min-w-0 break-words")}>
                      {alias.alias}
                    </span>
                    <div className="flex items-center gap-2">
                      <AliasEditDialog alias={alias} onUpdate={onUpdate} />
                      <AlertDialog
                        title="別名を削除しますか？"
                        description={`${memberDisplayName(alias.memberId)} の ${alias.alias} を削除します。`}
                        confirmLabel="削除"
                        formatError={(error) => formatApiError(error, "別名の削除に失敗しました")}
                        onConfirm={() => onDelete(alias.id)}
                        trigger={
                          <IconButton
                            aria-label="別名を削除"
                            icon={<Trash2 />}
                            size="sm"
                            tooltip="別名を削除"
                            variant="quiet"
                          />
                        }
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function AliasEditDialog({
  alias,
  onUpdate,
}: {
  alias: MemberAliasResponse;
  onUpdate: (id: string, request: { memberId: string; alias: string }) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const submitting = useRef(false);

  return (
    <Dialog
      busy={pending}
      open={open}
      onOpenChange={(next) => {
        if (next) setError(undefined);
        setOpen(next);
      }}
      title="別名を編集"
      trigger={
        <IconButton
          aria-label="別名を編集"
          icon={<Pencil />}
          size="sm"
          tooltip="別名を編集"
          variant="quiet"
        />
      }
    >
      <form
        className="grid gap-4"
        onSubmit={async (event) => {
          event.preventDefault();
          if (submitting.current) return;
          submitting.current = true;
          setError(undefined);
          setPending(true);
          const formData = new FormData(event.currentTarget);
          try {
            await onUpdate(alias.id, {
              memberId: String(formData.get("memberId") ?? ""),
              alias: String(formData.get("alias") ?? ""),
            });
            setOpen(false);
          } catch (caught) {
            setError(formatApiError(caught, "別名の更新に失敗しました"));
          } finally {
            submitting.current = false;
            setPending(false);
          }
        }}
      >
        <SelectField
          disabled={pending}
          defaultValue={alias.memberId}
          label="プレーヤー"
          name="memberId"
          options={canonicalResultMembers.map((member) => ({
            label: member.displayName,
            value: member.memberId,
          }))}
        />
        <TextField
          disabled={pending}
          defaultValue={alias.alias}
          error={error}
          label="別名"
          name="alias"
          required
        />
        <Button disabled={pending} pending={pending} pendingLabel="保存中" type="submit">
          保存
        </Button>
      </form>
    </Dialog>
  );
}
