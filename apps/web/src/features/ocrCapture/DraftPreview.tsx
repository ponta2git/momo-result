import type { CaptureSlotView } from "@/features/ocrCapture/captureSlotView";
import { Disclosure } from "@/shared/ui/data/Collapsible";
import { FactList } from "@/shared/ui/data/FactList";

type DraftPreviewProps = {
  draft: CaptureSlotView["draft"];
};

export function DraftPreview({ draft }: DraftPreviewProps) {
  if (!draft) {
    return null;
  }
  const warning = draft.warning;

  return (
    <Disclosure panelPadding="sm" presentation="framed" summary="読み取り結果">
      <FactList
        ariaLabel="読み取り結果"
        items={[
          { id: "screen", label: "読み取り画面", value: draft.screen },
          ...(warning ? [{ id: "warning", label: "確認事項", value: warning }] : []),
        ]}
        layout="plain"
      />
    </Disclosure>
  );
}
