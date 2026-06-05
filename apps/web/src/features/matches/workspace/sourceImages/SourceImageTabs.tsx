import { useCallback } from "react";

import {
  sourceImageKindLabels,
  sourceImageKinds,
} from "@/features/matches/workspace/sourceImages/sourceImageTypes";
import type { SourceImageKind } from "@/features/matches/workspace/sourceImages/sourceImageTypes";
import { SegmentedControl } from "@/shared/ui/forms/SegmentedControl";

const sourceImageKindOptions = sourceImageKinds.map((kind) => ({
  label: sourceImageKindLabels[kind],
  value: kind,
}));

type SourceImageTabsProps = {
  activeKind: SourceImageKind;
  onChange: (kind: SourceImageKind) => void;
};

export function SourceImageTabs({ activeKind, onChange }: SourceImageTabsProps) {
  const handleValueChange = useCallback(
    (value: string) => {
      onChange(value as SourceImageKind);
    },
    [onChange],
  );

  return (
    <SegmentedControl
      label="元画像の種別"
      options={sourceImageKindOptions}
      value={activeKind}
      onValueChange={handleValueChange}
    />
  );
}
