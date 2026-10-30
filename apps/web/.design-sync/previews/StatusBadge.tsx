import { CircleCheck, TriangleAlert } from "lucide-react";
import { StatusBadge } from "momo-result-ui";

export const Tones = () => (
  <div className="flex flex-wrap items-center gap-2">
    <StatusBadge label="確定" tone="neutral" />
    <StatusBadge label="取り込み済み" tone="info" />
    <StatusBadge label="要確認" tone="attention" />
    <StatusBadge label="ログイン許可" tone="success" />
    <StatusBadge label="ログイン停止" tone="warning" />
    <StatusBadge label="読み取り失敗" tone="danger" />
  </div>
);

export const WithIcon = () => (
  <div className="flex flex-wrap items-center gap-2">
    <StatusBadge icon={<CircleCheck />} label="優勝" tone="success" />
    <StatusBadge icon={<TriangleAlert />} label="総資産が未入力" tone="warning" />
  </div>
);

export const Busy = () => (
  <div className="flex flex-wrap items-center gap-2">
    <StatusBadge busy label="OCR解析中" tone="info" />
    <StatusBadge busy label="再計算中" note="残り2件" />
  </div>
);

export const WithNote = () => (
  <div className="flex flex-wrap items-center gap-2">
    <StatusBadge label="サンプル" note="第12回の結果" tone="attention" />
    <StatusBadge label="管理者" tone="neutral" />
  </div>
);
