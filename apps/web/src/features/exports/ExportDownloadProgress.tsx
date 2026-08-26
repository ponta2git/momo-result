import { Notice } from "@/shared/ui/feedback/Notice";

type ExportDownloadProgressProps = {
  isPending: boolean;
  isSlow: boolean;
};

export function ExportDownloadProgress({ isPending, isSlow }: ExportDownloadProgressProps) {
  if (!isPending) return null;

  return (
    <Notice
      tone={isSlow ? "warning" : "info"}
      title={isSlow ? "通常より時間がかかっています" : "出力ファイルを作成しています"}
    >
      {isSlow
        ? "ファイル作成が終わるまで、この画面のままお待ちください。"
        : "ダウンロードが始まるまで少しお待ちください。"}
    </Notice>
  );
}
