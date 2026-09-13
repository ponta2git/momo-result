import { Notice } from "@/shared/ui/feedback/Notice";

type ExportDownloadProgressProps = {
  isPending: boolean;
  isSlow: boolean;
};

export function ExportDownloadProgress({ isPending, isSlow }: ExportDownloadProgressProps) {
  if (!isPending || !isSlow) return null;

  return (
    <Notice tone="warning" title="通常より時間がかかっています">
      ファイル作成が終わるまで、この画面のままお待ちください。
    </Notice>
  );
}
