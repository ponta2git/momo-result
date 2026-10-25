import { ProgressBar } from "momo-result-ui";

export const Upload = () => (
  <div className="grid gap-2">
    <p className="text-sm">画像を送信しています（4件中3件）</p>
    <ProgressBar
      aria-label="画像送信の進捗"
      aria-valuetext="4件中3件の送信処理が完了"
      max={4}
      value={3}
    />
  </div>
);

export const Steps = () => (
  <div className="grid gap-4">
    <ProgressBar aria-label="開始直後" max={10} value={0} />
    <ProgressBar aria-label="途中" max={10} value={4} />
    <ProgressBar aria-label="完了" max={10} value={10} />
  </div>
);
