import type { SeriesComparisonViewId } from "@/features/seriesComparison/seriesComparisonViewModel";
import {
  defaultSeriesComparisonView,
  isSeriesComparisonViewId,
} from "@/features/seriesComparison/seriesComparisonViewModel";
import { cn } from "@/shared/ui/cn";
import { TabsList, TabsRoot, TabsTab } from "@/shared/ui/forms/Tabs";

type AnalysisViewDefinition = {
  description: string;
  id: SeriesComparisonViewId;
  label: string;
  sections: Array<{ id: string; label: string }>;
};

export type AnalysisViewChange = (
  view: SeriesComparisonViewId,
  options?: { replace?: boolean },
) => void;

const analysisViews = [
  {
    description: "次回4戦で試す行動仮説を、発動条件と根拠で絞ります。",
    id: "review",
    label: "振り返り",
    sections: [{ id: "review-playbook", label: "行動プレイブック" }],
  },
  {
    description: "平均順位、直接対決、順位ブレで、地力と相性を確認します。",
    id: "overview",
    label: "順位と相性",
    sections: [
      { id: "metric-basic", label: "順位" },
      { id: "metric-head-to-head", label: "直接対決" },
      { id: "metric-rate", label: "安定性" },
    ],
  },
  {
    description: "総資産、物件収益、カード寄り、目的地到着から勝ち筋を確認します。",
    id: "drivers",
    label: "勝ち筋",
    sections: [
      { id: "metric-money", label: "資産と勝ち筋" },
      { id: "metric-revenue-outcome", label: "物件収益と勝ち" },
      { id: "metric-destination-outcome", label: "目的地と勝ち" },
    ],
  },
  {
    description: "荒れ試合、直近8戦、切り替え、第n試合別の傾向を確認します。",
    id: "flow",
    label: "流れと勢い",
    sections: [
      { id: "metric-match-digest", label: "期間内の荒れ" },
      { id: "metric-recent-form", label: "直近" },
      { id: "metric-momentum-switch", label: "切り替え" },
      { id: "metric-match-no", label: "第n試合傾向" },
    ],
  },
  {
    description: "番手、カード売り場、スリの銀次など、試合条件と出来事を確認します。",
    id: "context",
    label: "番手と出来事",
    sections: [
      { id: "metric-play-order", label: "番手" },
      { id: "metric-card-shop-destination", label: "売り場×目的地" },
      { id: "metric-ginji", label: "スリの銀次" },
    ],
  },
] satisfies AnalysisViewDefinition[];

export function analysisViewFor(view: SeriesComparisonViewId | undefined): AnalysisViewDefinition {
  const fallback = analysisViews.find((item) => item.id === defaultSeriesComparisonView);
  if (!fallback) {
    throw new Error("default series comparison view is not configured");
  }
  return analysisViews.find((item) => item.id === view) ?? fallback;
}

export function AnalysisTabs({
  activeView,
  onViewChange,
}: {
  activeView: SeriesComparisonViewId;
  onViewChange: (view: SeriesComparisonViewId) => void;
}) {
  return (
    <TabsRoot
      className="grid min-w-0 gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
      value={activeView}
      onValueChange={(value) => {
        if (typeof value === "string" && isSeriesComparisonViewId(value)) {
          onViewChange(value);
        }
      }}
    >
      <TabsList aria-label="分析サブページ" className="flex min-w-0 flex-wrap gap-2">
        {analysisViews.map((item) => (
          <TabsTab
            className={cn(
              "inline-flex min-h-10 min-w-0 items-center gap-2 rounded-[var(--radius-sm)] border px-3 py-2 text-sm font-semibold transition-colors",
              item.id === activeView
                ? "border-[var(--color-action)]/60 bg-[var(--color-action)]/12 text-[var(--color-text-primary)]"
                : "border-[var(--color-border)] bg-[var(--color-surface-subtle)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface)]",
            )}
            key={item.id}
            value={item.id}
          >
            <span>{item.label}</span>
          </TabsTab>
        ))}
      </TabsList>
      <p className="text-sm leading-6 text-pretty text-[var(--color-text-secondary)]">
        {analysisViewFor(activeView).description}
      </p>
    </TabsRoot>
  );
}

export function SectionJumpLinks({ items }: { items: AnalysisViewDefinition["sections"] }) {
  if (items.length <= 1) {
    return null;
  }
  return (
    <nav aria-label="このサブページの観点" className="min-w-0">
      <div className="flex min-w-0 flex-wrap gap-2">
        {items.map((item) => (
          <a
            className="inline-flex rounded-full border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface)]"
            href={`#${item.id}`}
            key={item.id}
          >
            {item.label}
          </a>
        ))}
      </div>
    </nav>
  );
}
