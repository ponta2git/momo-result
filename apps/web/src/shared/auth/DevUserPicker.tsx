import { useQueryClient } from "@tanstack/react-query";

import { useDevUser } from "@/shared/auth/useDevUser";
import { canonicalResultMembers } from "@/shared/domain/members";
import { cn } from "@/shared/ui/cn";
import { SelectField } from "@/shared/ui/forms/SelectField";

type DevUserPickerProps = {
  embedded?: boolean;
  force?: boolean;
};

export function DevUserPicker({ embedded = false, force = false }: DevUserPickerProps) {
  const queryClient = useQueryClient();
  const { devUser, setDevUser, lockedByEnv } = useDevUser();

  if (!import.meta.env.DEV && !force) {
    return null;
  }

  const devAccounts = canonicalResultMembers.map((member) => ({
    accountId: `account_${member.memberId.replace(/^member_/u, "")}`,
    displayName: member.displayName,
  }));

  return (
    <div
      className={cn(
        embedded
          ? "grid gap-2"
          : "rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3",
      )}
    >
      <SelectField
        description={lockedByEnv ? "ローカル設定で固定されています。" : undefined}
        disabled={lockedByEnv}
        label="操作用アカウント"
        options={[
          { label: "未選択", value: "" },
          ...devAccounts.map((account) => ({
            label: `${account.displayName} (${account.accountId})`,
            value: account.accountId,
          })),
        ]}
        value={devUser}
        onChange={(event) => {
          const next = event.currentTarget.value;
          if (next === devUser) return;
          setDevUser(next);
          void queryClient.invalidateQueries();
        }}
      />
    </div>
  );
}
