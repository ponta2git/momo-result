import { usePrincipalSwitchCommand } from "@/shared/auth/usePrincipalSwitchCommand";
import { canonicalResultMembers } from "@/shared/domain/members";
import { SelectField } from "@/shared/ui/forms/SelectField";

const options = [
  { label: "未選択", value: "" },
  ...canonicalResultMembers.map(({ memberId, displayName }) => {
    const value = `account_${memberId.replace(/^member_/u, "")}`;
    return { label: `${displayName} (${value})`, value };
  }),
];

export function DevUserPicker() {
  const { currentPrincipal, switchPrincipal } = usePrincipalSwitchCommand();
  return (
    <SelectField
      label="操作用アカウント"
      options={options}
      value={currentPrincipal}
      onValueChange={(nextValue) => {
        void switchPrincipal(nextValue);
      }}
    />
  );
}
