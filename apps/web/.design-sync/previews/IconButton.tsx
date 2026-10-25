import { Minus, Pencil, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { IconButton } from "momo-result-ui";

export const Variants = () => (
  <div className="flex flex-wrap items-center gap-2">
    <IconButton aria-label="ももたろうを編集" icon={<Pencil />} variant="secondary" />
    <IconButton
      aria-label="2026/10/24 の開催を削除"
      icon={<Trash2 />}
      tooltip="空の開催を削除"
      variant="quiet"
    />
    <IconButton aria-label="第12回の結果を削除" icon={<Trash2 />} variant="danger" />
  </div>
);

export const Sizes = () => (
  <div className="flex flex-wrap items-center gap-2">
    <IconButton aria-label="入力を取り消す" icon={<X />} size="sm" variant="quiet" />
    <IconButton aria-label="最新情報に更新" icon={<RefreshCw />} size="md" />
    <IconButton aria-label="最新情報に更新" icon={<RefreshCw />} size="lg" />
  </div>
);

export const Stepper = () => (
  <div className="flex items-center gap-3">
    <IconButton aria-label="1位から2位へ1回移す" icon={<Minus />} size="sm" />
    <span className="min-w-12 text-center tabular-nums">3回</span>
    <IconButton aria-label="2位から1位へ1回移す" icon={<Plus />} size="sm" />
  </div>
);

export const States = () => (
  <div className="flex flex-wrap items-center gap-2">
    <IconButton
      aria-label="最新情報に更新"
      icon={<RefreshCw />}
      pending
      pendingLabel="一覧を更新中"
    />
    <IconButton aria-label="ももたろうを編集" disabled icon={<Pencil />} />
  </div>
);
