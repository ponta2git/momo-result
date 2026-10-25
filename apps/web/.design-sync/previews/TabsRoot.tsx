import { TabsList, TabsPanel, TabsRoot, TabsTab } from "momo-result-ui";

export const Filled = () => (
  <TabsRoot defaultValue="recalculation">
    <TabsList aria-label="戦績分析管理の表示切替">
      <TabsTab value="recalculation">分析の再計算</TabsTab>
      <TabsTab value="radar">レーダーの採点基準</TabsTab>
    </TabsList>
    <TabsPanel value="recalculation">
      <p className="mt-4 text-sm text-[var(--color-text-secondary)]">
        直近の再計算は 2026/10/24 21:05 に完了しました。
      </p>
    </TabsPanel>
    <TabsPanel value="radar">
      <p className="text-sm">採点基準の一覧</p>
    </TabsPanel>
  </TabsRoot>
);

export const Underline = () => (
  <TabsRoot defaultValue="current">
    <TabsList aria-label="採点基準の表示切替" variant="underline">
      <TabsTab value="current">現在の採点境界</TabsTab>
      <TabsTab value="history">改訂履歴</TabsTab>
    </TabsList>
    <TabsPanel value="current">
      <p className="mt-4 text-sm text-[var(--color-text-secondary)]">第3版（2026/10/01 適用）</p>
    </TabsPanel>
    <TabsPanel value="history">
      <p className="mt-4 text-sm">改訂履歴</p>
    </TabsPanel>
  </TabsRoot>
);
