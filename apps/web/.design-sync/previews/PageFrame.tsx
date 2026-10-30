import { Plus } from "lucide-react";
import {
  Button,
  FactList,
  Notice,
  PageContentSurface,
  PageFrame,
  PageHeader,
} from "momo-result-ui";

export const StandardPage = () => (
  <div className="p-4" style={{ background: "var(--color-canvas)" }}>
    <PageFrame>
      <PageHeader
        actions={<Button icon={<Plus aria-hidden="true" />}>試合を登録</Button>}
        description="開催ごとの試合結果と最終順位を確認できます。"
        title="試合結果"
      />
      <Notice title="追加の再計算が予約されています" tone="info">
        2件・最古 2026/10/24 21:05
      </Notice>
      <PageContentSurface>
        <FactList
          ariaLabel="シリーズ通算"
          columns={2}
          items={[
            { id: "matches", label: "試合数", value: "12試合" },
            { id: "leader", label: "通算首位", value: "ももたろう（5勝）" },
          ]}
        />
      </PageContentSurface>
    </PageFrame>
  </div>
);

export const Narrow = () => (
  <div className="p-4" style={{ background: "var(--color-canvas)" }}>
    <PageFrame width="narrow">
      <PageHeader
        description="プレイヤー名は順位表と実績に表示されます。"
        title="プレイヤーを追加"
      />
      <PageContentSurface>
        <p className="text-sm">狭い幅は入力フォームや確認画面に使います。</p>
      </PageContentSurface>
    </PageFrame>
  </div>
);
