import { TabsList, TabsPanel, TabsRoot, TabsTab } from "momo-result-ui";

const axes = [
  { id: "assets", label: "資産力" },
  { id: "revenue", label: "収益力" },
  { id: "destination", label: "目的地" },
  { id: "card", label: "カード運用" },
  { id: "stability", label: "安定感" },
];

export const Filled = () => (
  <div className="max-w-sm">
    <TabsRoot defaultValue="assets">
      <TabsList aria-label="レーダーの観点">
        {axes.map((axis) => (
          <TabsTab key={axis.id} value={axis.id}>
            {axis.label}
          </TabsTab>
        ))}
      </TabsList>
      {axes.map((axis) => (
        <TabsPanel key={axis.id} value={axis.id}>
          <p className="mt-3 text-sm text-[var(--color-text-secondary)]">
            {axis.label}の採点境界を表示しています。
          </p>
        </TabsPanel>
      ))}
    </TabsRoot>
  </div>
);

export const Underline = () => (
  <div className="max-w-sm">
    <TabsRoot defaultValue="revenue">
      <TabsList aria-label="編集する観点" variant="underline">
        {axes.map((axis) => (
          <TabsTab key={axis.id} value={axis.id}>
            {axis.label}
          </TabsTab>
        ))}
      </TabsList>
      {axes.map((axis) => (
        <TabsPanel key={axis.id} value={axis.id}>
          <p className="mt-3 text-sm text-[var(--color-text-secondary)]">
            {axis.label}の境界値を編集します。
          </p>
        </TabsPanel>
      ))}
    </TabsRoot>
  </div>
);
