import { Link } from "react-router-dom";

import { Notice } from "@/shared/ui/feedback/Notice";

type ExportDownloadProgressProps = {
  isPending: boolean;
  isSlow: boolean;
};

export function ExportDownloadProgress({ isPending, isSlow }: ExportDownloadProgressProps) {
  if (!isPending) return null;

  return (
    <Notice
      action={
        <Link className="font-semibold text-[var(--color-action)] hover:underline" to="/matches">
          試合一覧へ戻る
        </Link>
      }
      tone={isSlow ? "warning" : "info"}
      title={isSlow ? "通常より時間がかかっています" : "出力ファイルを作成しています"}
    >
      {isSlow
        ? "画面を離れると、ファイル作成が中断される場合があります。"
        : "保存画面が開くまで少しお待ちください。"}
    </Notice>
  );
}
