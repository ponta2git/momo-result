import {
  sourceImageKindLabels,
  sourceImageKinds,
} from "@/features/matches/workspace/sourceImages/sourceImageTypes";
import { TabsList, TabsTab } from "@/shared/ui/forms/Tabs";

export function SourceImageTabs() {
  return (
    <TabsList activateOnFocus={false} aria-label="元画像の種別">
      {sourceImageKinds.map((kind) => (
        <TabsTab key={kind} value={kind}>
          {sourceImageKindLabels[kind]}
        </TabsTab>
      ))}
    </TabsList>
  );
}
