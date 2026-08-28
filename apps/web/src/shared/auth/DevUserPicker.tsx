import { usePrincipalSwitchCommand } from "@/shared/auth/usePrincipalSwitchCommand";
import { canonicalResultMembers } from "@/shared/domain/members";
import { cn } from "@/shared/ui/cn";
import { SelectField } from "@/shared/ui/forms/SelectField";

type DevUserPickerProps = {
  embedded?: boolean;
  force?: boolean;
};

export function DevUserPicker({ embedded = false, force = false }: DevUserPickerProps) {
  const { currentPrincipal, switchPrincipal } = usePrincipalSwitchCommand();

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
        label="操作用アカウント"
        options={[
          { label: "未選択", value: "" },
          ...devAccounts.map((account) => ({
            label: `${account.displayName} (${account.accountId})`,
            value: account.accountId,
          })),
        ]}
        value={currentPrincipal}
        onChange={(event) => {
          void switchPrincipal(event.currentTarget.value);
        }}
      />
    </div>
  );
}
