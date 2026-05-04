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
    <div className={disabled ? "pointer-events-none opacity-60" : ""}>
      <SegmentedControl
        className="w-full"
        label="出力範囲"
        options={exportScopes.map((item) => ({ label: item.label, value: item.value }))}
        value={scope}
        onValueChange={(value) => onChange(value as ExportScope)}
      />
      <p className="mt-2 text-sm leading-6 text-[var(--color-text-secondary)]">
        {exportScopes.find((item) => item.value === scope)?.description}
      </p>
    </div>
  );
}
