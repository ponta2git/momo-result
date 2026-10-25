import { PendingStatus } from "momo-result-ui";

export const Pending = () => <PendingStatus pending>選択した作品の設定を読み込み中</PendingStatus>;

export const WithIdleLabel = () => (
  <div className="grid gap-2">
    <PendingStatus idleLabel="読み取り結果に引き継ぐ試合設定" pending={false}>
      試合設定を更新中
    </PendingStatus>
    <PendingStatus idleLabel="読み取り結果に引き継ぐ試合設定" pending>
      試合設定を更新中
    </PendingStatus>
  </div>
);

export const WithoutSpinner = () => (
  <PendingStatus pending spinner={false}>
    一覧を更新中
  </PendingStatus>
);
