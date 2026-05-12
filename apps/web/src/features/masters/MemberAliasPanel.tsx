import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";

import type { MemberAliasResponse } from "@/shared/api/masters";
import { formatApiError } from "@/shared/api/problemDetails";
import { fixedMembers } from "@/shared/domain/members";
import { Button } from "@/shared/ui/actions/Button";
import { IconButton } from "@/shared/ui/actions/IconButton";
import { AlertDialog, Dialog } from "@/shared/ui/feedback/Dialog";
import { EmptyState } from "@/shared/ui/feedback/EmptyState";
import { Field } from "@/shared/ui/forms/Field";

const inputClass =
  "w-full min-w-0 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)]";
const labelClass = "text-xs font-semibold text-[var(--color-text-secondary)]";

type MemberAliasPanelProps = {
  aliases: MemberAliasResponse[];
  createAction: (formData: FormData) => void | Promise<void>;
  createError?: string | undefined;
  createFormKey?: string | number | undefined;
  onDelete: (id: string) => Promise<void> | void;
  onUpdate: (id: string, request: { memberId: string; alias: string }) => Promise<void>;
};

function memberName(memberId: string): string {
  return fixedMembers.find((member) => member.memberId === memberId)?.displayName ?? memberId;
}

export function MemberAliasPanel({
  aliases,
  createAction,
  createError,
  createFormKey,
  onDelete,
  onUpdate,
}: MemberAliasPanelProps) {
  const aliasesByMember = fixedMembers.map((member) => ({
    member,
    aliases: aliases.filter((alias) => alias.memberId === member.memberId),
  }));

  return (
    <section className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <header>
        <p className={labelClass}>読み取り用の名前</p>
        <h2 className="mt-1 text-lg font-semibold text-[var(--color-text-primary)]">
          プレーヤー名の別名
        </h2>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          画像から読み取られる表記を正式なプレーヤー名に紐づけます。
        </p>
      </header>

      <form
        action={createAction}
        className="mt-4 grid gap-3 md:grid-cols-[minmax(12rem,0.35fr)_minmax(12rem,1fr)_auto]"
        key={createFormKey}
      >
        <Field label="プレーヤー">
          <select className={inputClass} name="memberId">
            {fixedMembers.map((member) => (
              <option key={member.memberId} value={member.memberId}>
                {member.displayName}
              </option>
            ))}
          </select>
        </Field>
        <Field label="別名">
          <input className={inputClass} name="alias" placeholder="例: NO11社長" required />
        </Field>
        <div className="flex items-end">
          <Button type="submit">追加</Button>
        </div>
        {createError ? (
          <p className="text-sm text-[var(--color-danger)] md:col-span-3" role="alert">
            {createError}
          </p>
        ) : null}
      </form>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {aliasesByMember.map(({ member, aliases: memberAliases }) => (
          <div
            className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3"
            key={member.memberId}
          >
            <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
              {member.displayName}
            </h3>
            {memberAliases.length === 0 ? (
              <EmptyState className="mt-2" title="未登録" description="別名はまだありません。" />
            ) : (
              <ul className="mt-2 grid gap-2">
                {memberAliases.map((alias) => (
                  <li
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
                    key={alias.id}
                  >
                    <span className="min-w-0 truncate text-sm font-semibold text-[var(--color-text-primary)]">
                      {alias.alias}
                    </span>
                    <div className="flex items-center">
                      <AliasEditDialog alias={alias} onUpdate={onUpdate} />
                      <AlertDialog
                        title="別名を削除しますか？"
                        description={`${memberName(alias.memberId)} の ${alias.alias} を削除します。`}
                        confirmLabel="削除"
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
        <Field label="プレーヤー">
          <select className={inputClass} defaultValue={alias.memberId} name="memberId">
            {fixedMembers.map((member) => (
              <option key={member.memberId} value={member.memberId}>
                {member.displayName}
              </option>
            ))}
          </select>
        </Field>
        <Field label="別名">
          <input className={inputClass} defaultValue={alias.alias} name="alias" required />
        </Field>
        {error ? <p className="text-sm text-[var(--color-danger)]">{error}</p> : null}
        <Button disabled={pending} pending={pending} pendingLabel="保存中" type="submit">
          保存
        </Button>
      </form>
    </Dialog>
  );
}
