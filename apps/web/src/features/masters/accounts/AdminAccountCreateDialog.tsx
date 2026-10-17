import { UserPlus } from "lucide-react";
import { startTransition } from "react";

import { accountRoleOptions } from "@/features/masters/accounts/accountRoles";
import type { AdminAccountCreateForm } from "@/features/masters/accounts/accountSettingsEditing";
import { canonicalResultMembers } from "@/shared/domain/members";
import { Button } from "@/shared/ui/actions/Button";
import { Dialog, DialogFooter } from "@/shared/ui/feedback/Dialog";
import { Notice } from "@/shared/ui/feedback/Notice";
import { CheckboxField } from "@/shared/ui/forms/CheckboxField";
import { SelectField } from "@/shared/ui/forms/SelectField";
import { TextField } from "@/shared/ui/forms/TextField";

const accountPlayerOptions = [
  { label: "試合参加者に紐づけない", value: "" },
  ...canonicalResultMembers.map((member) => ({
    label: member.displayName,
    value: member.memberId,
  })),
];

export function AdminAccountCreateDialog({ form }: { form: AdminAccountCreateForm }) {
  const { action, disabled, error, open, pending, setOpen } = form;
  return (
    <Dialog
      busy={pending}
      description="Discordの利用者にログイン許可とロールを設定し、必要に応じて試合参加者を紐づけます。"
      open={open}
      title="アカウントを追加"
      trigger={
        <Button disabled={disabled} icon={<UserPlus />} size="sm" variant="secondary">
          アカウントを追加
        </Button>
      }
      onOpenChange={setOpen}
    >
      <form
        className="grid gap-6"
        onSubmit={(event) => {
          event.preventDefault();
          if (pending) return;
          const formData = new FormData(event.currentTarget);
          // Dispatch explicitly: resolved error Actions must not trigger an automatic form reset.
          startTransition(() => action(formData));
        }}
      >
        {error ? (
          <Notice role="alert" tone="danger" title="アカウントを追加できません">
            {error}
          </Notice>
        ) : null}
        <div className="grid gap-4">
          <TextField
            disabled={pending}
            inputMode="numeric"
            label="DiscordユーザーID"
            name="discordUserId"
            placeholder="例: 523484457705930752"
            required
          />
          <TextField
            disabled={pending}
            label="表示名"
            name="displayName"
            placeholder="例: 代理入力者"
            required
          />
          <SelectField
            disabled={pending}
            defaultValue=""
            label="紐づくプレーヤー"
            name="playerMemberId"
            options={accountPlayerOptions}
          />
          <fieldset className="grid min-w-0 gap-4">
            <legend className="sr-only">権限</legend>
            <CheckboxField
              disabled={pending}
              defaultChecked
              label="ログイン許可"
              name="loginEnabled"
            />
            <SelectField
              defaultValue="user"
              disabled={pending}
              label="ロール"
              name="role"
              options={accountRoleOptions}
              required
            />
          </fieldset>
        </div>
        <DialogFooter>
          <Button disabled={pending} variant="secondary" onClick={() => setOpen(false)}>
            キャンセル
          </Button>
          <Button pending={pending} pendingLabel="追加中" type="submit">
            追加
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
