import { SegmentedControl } from "@/shared/ui/forms/SegmentedControl";

import type { ExportFormat } from "./exportTypes";
import { exportFormats } from "./exportViewModel";

type ExportFormatSegmentProps = {
  disabled?: boolean;
  format: ExportFormat;
  onChange: (format: ExportFormat) => void;
};

export function ExportFormatSegment({ disabled, format, onChange }: ExportFormatSegmentProps) {
  return (
    <div className={disabled ? "pointer-events-none opacity-60" : ""}>
      <SegmentedControl
        label="ファイル形式"
        options={exportFormats.map((item) => ({ label: item.label, value: item.value }))}
        value={format}
        onValueChange={(value) => onChange(value as ExportFormat)}
      />
    </div>
  );
}
