import type { SeriesAnalysisViewId } from "@/features/seriesComparison/model/seriesAnalysisViewModel";
import { isSeriesAnalysisViewId } from "@/features/seriesComparison/model/seriesAnalysisViewModel";
import { cn } from "@/shared/ui/cn";
import { TabsList, TabsRoot, TabsTab } from "@/shared/ui/forms/Tabs";

type AnalysisViewId = Exclude<SeriesAnalysisViewId, "review">;

type AnalysisViewDefinition = {
  id: AnalysisViewId;
  label: string;
  sections: Array<{ id: string; label: string }>;
};

type PurposeId = "analysis" | "review";

const analysisViews = [
  {
    id: "overview",
    label: "今の差",
    sections: [
      { id: "metric-basic", label: "順位" },
      { id: "metric-crown-certainty", label: "王座の確からしさ" },
      { id: "metric-head-to-head", label: "直接対決" },
      { id: "metric-rate", label: "安定性" },
    ],
  },
  {
    id: "drivers",
    label: "勝因候補",
    sections: [
      { id: "metric-money", label: "資産の残し方" },
      { id: "metric-revenue-outcome", label: "物件収益と勝ち" },
      { id: "metric-destination-outcome", label: "目的地と順位" },
      { id: "metric-strategy-scatter", label: "試合ごとの資産と収益" },
      { id: "metric-rank-signals", label: "追加の手掛かり" },
    ],
  },
  {
    id: "flow",
    label: "推移",
    sections: [
      { id: "metric-match-digest", label: "期間内の荒れ" },
      { id: "metric-unexpected-wins", label: "記録外の一撃" },
      { id: "metric-recent-form", label: "直近" },
      { id: "metric-momentum-switch", label: "切り替え" },
      { id: "metric-match-no", label: "第n試合傾向" },
    ],
  },
  {
    id: "context",
    label: "条件別",
    sections: [
      { id: "metric-play-order", label: "番手" },
      { id: "metric-card-shop-destination", label: "売り場×目的地" },
      { id: "metric-ginji", label: "スリの銀次" },
    ],
  },
] satisfies AnalysisViewDefinition[];

export function purposeTabId(purpose: PurposeId): string {
  return `series-comparison-purpose-tab-${purpose}`;
}

export function purposePanelId(purpose: PurposeId): string {
  return `series-comparison-purpose-panel-${purpose}`;
}

export function analysisTabId(view: AnalysisViewId): string {
  return `series-comparison-tab-${view}`;
}

export function analysisPanelId(view: AnalysisViewId): string {
  return `series-comparison-view-${view}`;
}

function tabClassName(active: boolean, emphasis: "primary" | "secondary"): string {
  return cn(
    "-mb-px inline-flex min-h-11 min-w-0 items-center border-b-2 px-3 text-sm font-semibold transition-colors duration-[var(--motion-fast)] motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-action)]",
    emphasis === "primary" && "sm:text-base",
    active
      ? "border-[var(--color-action)] text-[var(--color-text-primary)]"
      : "border-transparent text-[var(--color-text-secondary)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text-primary)]",
  );
}

export function PurposeTabs({
  activeView,
  onViewChange,
}: {
  activeView: SeriesAnalysisViewId;
  onViewChange: (view: SeriesAnalysisViewId) => void;
}) {
  const activePurpose: PurposeId = activeView === "review" ? "review" : "analysis";
  return (
    <TabsRoot
      className="w-full max-w-full min-w-0"
      value={activePurpose}
      onValueChange={(value) => {
        if (value === "review") {
          onViewChange("review");
        } else if (value === "analysis") {
          onViewChange("overview");
        }
      }}
    >
      <TabsList
        aria-label="戦績比較の目的"
        className="flex min-w-0 border-b border-[var(--color-border)]"
      >
        <TabsTab
          aria-controls={purposePanelId("review")}
          className={tabClassName(activePurpose === "review", "primary")}
          id={purposeTabId("review")}
          value="review"
        >
          次戦に備える
        </TabsTab>
        <TabsTab
          aria-controls={purposePanelId("analysis")}
          className={tabClassName(activePurpose === "analysis", "primary")}
          id={purposeTabId("analysis")}
          value="analysis"
        >
          分析する
        </TabsTab>
      </TabsList>
    </TabsRoot>
  );
}

export function AnalysisTabs({
  activeView,
  onViewChange,
}: {
  activeView: AnalysisViewId;
  onViewChange: (view: SeriesAnalysisViewId) => void;
}) {
  return (
    <TabsRoot
      className="w-full max-w-full min-w-0"
      value={activeView}
      onValueChange={(value) => {
        if (typeof value === "string" && isSeriesAnalysisViewId(value) && value !== "review") {
          onViewChange(value);
        }
      }}
    >
      <TabsList
        aria-label="分析の切り口"
        className="flex min-w-0 overflow-x-auto overflow-y-hidden border-b border-[var(--color-border)]"
      >
        {analysisViews.map((item) => (
          <TabsTab
            aria-controls={analysisPanelId(item.id)}
            className={cn(tabClassName(item.id === activeView, "secondary"), "shrink-0")}
            id={analysisTabId(item.id)}
            key={item.id}
            value={item.id}
          >
            {item.label}
          </TabsTab>
        ))}
      </TabsList>
    </TabsRoot>
  );
}

export function AnalysisTableOfContents({ view }: { view: AnalysisViewId }) {
  const definition = analysisViews.find((item) => item.id === view);
  if (!definition) return null;
  return (
    <nav
      aria-label={`${definition.label}の目次`}
      className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-[var(--color-border)] pb-2 text-xs"
    >
      <span className="font-semibold text-[var(--color-text-secondary)]">このページ</span>
      <ol className="flex min-w-0 flex-wrap gap-x-3 gap-y-1">
        {definition.sections.map((section) => (
          <li key={section.id}>
            <a
              className="inline-flex min-h-11 items-center text-[var(--color-text-secondary)] underline decoration-[var(--color-border-strong)] underline-offset-4 hover:text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-action)]"
              href={`#${section.id}`}
            >
              {section.label}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
