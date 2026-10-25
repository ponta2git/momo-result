import { BarChart3, Trophy } from "lucide-react";
import { Button, EmptyState } from "momo-result-ui";

export const Embedded = () => (
  <EmptyState
    description="設定管理で作品を登録すると、戦績分析の対象にできます。"
    icon={<BarChart3 />}
    placement="embedded"
    title="登録されている作品がありません"
  />
);

export const WithAction = () => (
  <EmptyState
    action={<Button variant="secondary">全シーズン・全マップに戻す</Button>}
    description="シーズン・マップの選択は保持しています。条件を変更すると別の記録を確認できます。"
    placement="embedded"
    title="この範囲に確定済みの試合がありません"
  />
);

export const Standalone = () => (
  <EmptyState
    action={<Button>試合を登録</Button>}
    description="最初の試合結果を登録すると、ここに順位と総資産が並びます。"
    icon={<Trophy />}
    placement="standalone"
    title="まだ試合がありません"
  />
);

export const TitleOnly = () => <EmptyState placement="embedded" title="実行履歴はありません" />;
