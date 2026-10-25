import { Plus, Trash2 } from "lucide-react";
import { Button } from "momo-result-ui";

export const Variants = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Button variant="primary">試合を登録</Button>
    <Button variant="secondary">下書きを保存</Button>
    <Button variant="quiet">キャンセル</Button>
    <Button variant="danger">削除する</Button>
    <Button variant="dangerQuiet">記録を取り消す</Button>
  </div>
);

export const Sizes = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Button size="sm" variant="secondary">
      小
    </Button>
    <Button size="md" variant="secondary">
      中
    </Button>
    <Button size="lg" variant="secondary">
      大
    </Button>
  </div>
);

export const WithIcon = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Button icon={<Plus aria-hidden="true" />}>開催を追加</Button>
    <Button icon={<Trash2 aria-hidden="true" />} variant="danger">
      開催を削除
    </Button>
  </div>
);

export const States = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Button pending pendingLabel="保存中…">
      保存
    </Button>
    <Button disabled variant="secondary">
      保存済み
    </Button>
  </div>
);
