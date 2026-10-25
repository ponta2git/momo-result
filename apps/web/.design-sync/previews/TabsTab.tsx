import { TabsList, TabsPanel, TabsRoot, TabsTab } from "momo-result-ui";

export const SelectedSecond = () => (
  <TabsRoot defaultValue="radar">
    <TabsList aria-label="戦績分析管理の表示切替">
      <TabsTab value="recalculation">分析の再計算</TabsTab>
      <TabsTab value="radar">レーダーの採点基準</TabsTab>
      <TabsTab value="achievements">実績</TabsTab>
    </TabsList>
    <TabsPanel value="radar">
      <p className="mt-3 text-sm text-[var(--color-text-secondary)]">現在の採点基準は第3版です。</p>
    </TabsPanel>
  </TabsRoot>
);

export const DisabledTab = () => (
  <TabsRoot defaultValue="current">
    <TabsList aria-label="採点基準の表示切替" variant="underline">
      <TabsTab value="current">現在の採点境界</TabsTab>
      <TabsTab value="draft">下書き</TabsTab>
      <TabsTab disabled value="history">
        改訂履歴（権限なし）
      </TabsTab>
    </TabsList>
    <TabsPanel value="current">
      <p className="mt-3 text-sm text-[var(--color-text-secondary)]">第3版（2026/10/01 適用）</p>
    </TabsPanel>
  </TabsRoot>
);

export const NeedsReview = () => (
  <TabsRoot defaultValue="assets">
    <TabsList aria-label="編集する観点">
      <TabsTab value="assets">資産力</TabsTab>
      <TabsTab value="revenue">収益力（要確認）</TabsTab>
      <TabsTab disabled value="card">
        カード運用
      </TabsTab>
    </TabsList>
    <TabsPanel value="assets">
      <p className="mt-3 text-sm text-[var(--color-text-secondary)]">
        資産力の境界値は保存済みです。
      </p>
    </TabsPanel>
  </TabsRoot>
);
