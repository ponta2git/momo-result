import { Link } from "react-router-dom";

import { Notice } from "@/shared/ui/feedback/Notice";

type ExportDownloadProgressProps = {
  isPending: boolean;
  isSlow: boolean;
};

export function ExportDownloadProgress({ isPending, isSlow }: ExportDownloadProgressProps) {
  if (!isPending) return null;

  return (
    <div className="momo-enter grid gap-2">
      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-selected)]">
        <div className="h-full w-1/2 rounded-full bg-[var(--color-action)] motion-safe:animate-pulse motion-reduce:animate-none" />
      </div>
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
    </div>
  );
}
