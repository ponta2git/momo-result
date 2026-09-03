import { useFormStatus } from "react-dom";

import type { AdminAccountCreateDialogModel } from "@/features/adminAccounts/useAdminAccountsPageModel";
import { canonicalResultMembers } from "@/shared/domain/members";
import { Button } from "@/shared/ui/actions/Button";
import { Dialog, DialogFooter } from "@/shared/ui/feedback/Dialog";
import { Notice } from "@/shared/ui/feedback/Notice";
import { CheckboxField } from "@/shared/ui/forms/CheckboxField";
import { Fieldset } from "@/shared/ui/forms/Fieldset";
import { SelectField } from "@/shared/ui/forms/SelectField";
import { TextField } from "@/shared/ui/forms/TextField";

const accountPlayerOptions = [
  { label: "試合参加者に紐づけない", value: "" },
  ...canonicalResultMembers.map((member) => ({
    label: member.displayName,
    value: member.memberId,
  })),
];

export function AdminAccountCreateDialog({ model }: { model: AdminAccountCreateDialogModel }) {
  const { action, error, formKey, open, pending, setOpen } = model;
  return (
    <Dialog
      busy={pending}
      description="Discordの利用者と、必要な場合だけ試合参加者・管理者権限を紐づけます。"
      open={open}
      title="アカウントを追加"
      onOpenChange={setOpen}
    >
      <form key={formKey} action={action} className="grid gap-4">
        {error ? (
          <Notice role="alert" tone="danger" title="アカウントを追加できません">
            {error}
          </Notice>
        ) : null}
        <TextField
          inputMode="numeric"
          label="DiscordユーザーID"
          name="discordUserId"
          placeholder="例: 523484457705930752"
          required
        />
        <TextField label="表示名" name="displayName" placeholder="例: 代理入力者" required />
        <SelectField
          defaultValue=""
          label="紐づくプレーヤー"
          name="playerMemberId"
          options={accountPlayerOptions}
        />
        <Fieldset legend="権限">
          <CheckboxField defaultChecked label="ログイン許可" name="loginEnabled" />
          <CheckboxField label="管理者" name="isAdmin" />
        </Fieldset>
        <DialogFooter>
          <Button disabled={pending} variant="secondary" onClick={() => setOpen(false)}>
            キャンセル
          </Button>
          <CreateAccountSubmitButton />
        </DialogFooter>
      </form>
    </Dialog>
  );
}

function CreateAccountSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button pending={pending} pendingLabel="追加中" type="submit">
      追加
    </Button>
  );
}
