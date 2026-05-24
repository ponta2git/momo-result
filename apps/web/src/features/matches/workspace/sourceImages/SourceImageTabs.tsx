import {
  sourceImageKindLabels,
  sourceImageKinds,
} from "@/features/matches/workspace/sourceImages/sourceImageTypes";
import type { SourceImageKind } from "@/features/matches/workspace/sourceImages/sourceImageTypes";
import { SegmentedControl } from "@/shared/ui/forms/SegmentedControl";

type SourceImageTabsProps = {
  activeKind: SourceImageKind;
  onChange: (kind: SourceImageKind) => void;
};

export function SourceImageTabs({ activeKind, onChange }: SourceImageTabsProps) {
  return (
    <SegmentedControl
      label="元画像の種別"
      options={sourceImageKinds.map((kind) => ({
        label: sourceImageKindLabels[kind],
        value: kind,
      }))}
      value={activeKind}
      onValueChange={(value) => onChange(value as SourceImageKind)}
    />
  );
}
