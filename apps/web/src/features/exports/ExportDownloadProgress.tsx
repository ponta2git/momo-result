import { motion } from "motion/react";

import { Notice } from "@/shared/ui/feedback/Notice";
import { momoPanelTransition } from "@/shared/ui/motion/variants";

type ExportDownloadProgressProps = {
  isPending: boolean;
  isSlow: boolean;
};

export function ExportDownloadProgress({ isPending, isSlow }: ExportDownloadProgressProps) {
  if (!isPending) return null;

  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className="grid gap-2"
      initial={{ opacity: 0, y: 4 }}
      transition={momoPanelTransition}
    >
      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-selected)]">
        <motion.div
          animate={{ x: ["-60%", "160%"] }}
          className="h-full w-1/2 rounded-full bg-[var(--color-action)]"
          transition={{
            duration: 1.1,
            ease: "easeInOut",
            repeat: Number.POSITIVE_INFINITY,
          }}
        />
      </div>
      <Notice
        tone={isSlow ? "warning" : "info"}
        title={isSlow ? "通常より時間がかかっています" : "出力ファイルを作成しています"}
      >
        {isSlow
          ? "ファイル作成が終わるまで、この画面のままお待ちください。"
          : "保存画面が開くまで少しお待ちください。"}
      </Notice>
    </motion.div>
  );
}
