import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";

import { MasterResourceRefreshNotice } from "@/features/masters/MasterResourceRefreshNotice";
import type { MemberAliasResponse } from "@/shared/api/masters";
import { formatApiError } from "@/shared/api/problemDetails";
import { canonicalResultMembers, memberDisplayName } from "@/shared/domain/members";
import { Button } from "@/shared/ui/actions/Button";
import { IconButton } from "@/shared/ui/actions/IconButton";
import { MemberSequenceLabel } from "@/shared/ui/data/MemberSequenceLabel";
import { AlertDialog, Dialog } from "@/shared/ui/feedback/Dialog";
import { SelectField } from "@/shared/ui/forms/SelectField";
import { TextField } from "@/shared/ui/forms/TextField";

type MemberAliasPanelProps = {
  aliases: MemberAliasResponse[];
  createAction: (formData: FormData) => void | Promise<void>;
  createError?: string | undefined;
  createFormKey?: string | number | undefined;
  onDelete: (id: string) => Promise<void> | void;
  onRetry: () => void;
  onUpdate: (id: string, request: { memberId: string; alias: string }) => Promise<void>;
  refreshing: boolean;
  stale: boolean;
};

export function MemberAliasPanel({
  aliases,
  createAction,
  createError,
  createFormKey,
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
    <section className="min-w-0">
      <header>
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
          プレーヤー名の別名
        </h2>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          画像から読み取られる表記を正式なプレーヤー名に紐づけます。
        </p>
      </header>

      <MasterResourceRefreshNotice
        className="mt-3"
        onRetry={onRetry}
        resourceLabel="別名"
        retrying={refreshing}
        stale={stale}
      />

      <form
        action={createAction}
        className="mt-4 grid gap-3 md:grid-cols-[minmax(12rem,0.35fr)_minmax(12rem,1fr)_auto] md:grid-rows-[auto_auto_auto]"
        key={createFormKey}
      >
        <SelectField
          fieldClassName="md:row-span-3 md:grid md:grid-rows-subgrid"
          label="プレーヤー"
          name="memberId"
          options={canonicalResultMembers.map((member) => ({
            label: member.displayName,
            value: member.memberId,
          }))}
        />
        <TextField
          error={createError}
          fieldClassName="md:row-span-3 md:grid md:grid-rows-subgrid"
          label="別名"
          name="alias"
          placeholder="例: NO11社長"
          required
        />
        <Button
          className="md:col-start-3 md:row-start-2"
          pendingLabel="追加中"
          type="submit"
          variant="secondary"
        >
          追加
        </Button>
      </form>

      <div className="mt-4 grid gap-x-4 gap-y-6 md:grid-cols-2 xl:grid-cols-4">
        {aliasesByMember.map(({ member, aliases: memberAliases }) => (
          <div className="min-w-0" key={member.memberId}>
            <h3 className="min-w-0 text-sm font-semibold text-[var(--color-text-primary)]">
              <MemberSequenceLabel memberId={member.memberId}>
                <span className="truncate">{member.displayName}</span>
              </MemberSequenceLabel>
            </h3>
            {memberAliases.length === 0 ? (
              <p className="mt-3 text-sm text-[var(--color-text-secondary)]">別名なし</p>
            ) : (
              <ul className="mt-3 divide-y divide-[var(--color-border)]">
                {memberAliases.map((alias) => (
                  <li
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 py-2"
                    key={alias.id}
                  >
                    <span className="min-w-0 truncate text-sm font-semibold text-[var(--color-text-primary)]">
                      {alias.alias}
                    </span>
                    <div className="flex items-center">
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

  return (
    <Dialog
      busy={pending}
      open={open}
      onOpenChange={setOpen}
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
        className="grid gap-3"
        onSubmit={async (event) => {
          event.preventDefault();
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
            setPending(false);
          }
        }}
      >
        <SelectField
          defaultValue={alias.memberId}
          label="プレーヤー"
          name="memberId"
          options={canonicalResultMembers.map((member) => ({
            label: member.displayName,
            value: member.memberId,
          }))}
        />
        <TextField defaultValue={alias.alias} error={error} label="別名" name="alias" required />
        <Button disabled={pending} pending={pending} pendingLabel="保存中" type="submit">
          保存
        </Button>
      </form>
    </Dialog>
  );
}
