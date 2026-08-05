import { SegmentedControl } from "@/shared/ui/forms/SegmentedControl";

import type { ExportScope } from "./exportTypes";
import { exportScopes } from "./exportViewModel";

type ExportScopeSelectorProps = {
  disabled?: boolean;
  onChange: (scope: ExportScope) => void;
  scope: ExportScope;
};

export function ExportScopeSelector({ disabled, onChange, scope }: ExportScopeSelectorProps) {
  return (
    <SegmentedControl
      className="grid w-full grid-cols-2 sm:grid-cols-4"
      disabled={disabled}
      label="出力範囲"
      optionClassName="min-h-11"
      options={exportScopes.map((item) => ({ label: item.label, value: item.value }))}
      value={scope}
      onValueChange={(value) => onChange(value as ExportScope)}
    />
  );
}
