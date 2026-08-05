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
    <SegmentedControl
      className="grid w-full grid-cols-2 sm:w-64"
      disabled={disabled}
      label="ファイル形式"
      optionClassName="min-h-11"
      options={exportFormats.map((item) => ({ label: item.label, value: item.value }))}
      value={format}
      onValueChange={(value) => onChange(value as ExportFormat)}
    />
  );
}
