import { useId } from "react";
import type { ReactNode } from "react";

import { cn } from "@/shared/ui/cn";
import { TabsList, TabsPanel, TabsRoot, TabsTab } from "@/shared/ui/forms/Tabs";
import { contentText } from "@/shared/ui/typography";

import { exportScopes } from "./exportPresentation";
import type { ExportScope } from "./exportTypes";

const exportExclusionNotice = "下書きや確認待ちの試合は含みません。";

type ExportScopeTabsProps = {
  children: ReactNode;
  disabled?: boolean;
  onChange: (scope: ExportScope) => void;
  scope: ExportScope;
};

function isExportScope(value: unknown): value is ExportScope {
  return exportScopes.some((scope) => scope.value === value);
}

export function ExportScopeTabs({
  children,
  disabled = false,
  onChange,
  scope,
}: ExportScopeTabsProps) {
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} className="grid gap-2">
      <div className="grid gap-1">
        <h2 className={contentText.heading} id={headingId}>
          出力範囲
        </h2>
        <p className={cn(contentText.body, "text-pretty")}>{exportExclusionNotice}</p>
      </div>
      <TabsRoot
        value={scope}
        onValueChange={(value) => {
          if (isExportScope(value)) onChange(value);
        }}
      >
        <TabsList activateOnFocus={false} aria-labelledby={headingId}>
          {exportScopes.map((item) => (
            <TabsTab disabled={disabled} key={item.value} value={item.value}>
              {item.label}
            </TabsTab>
          ))}
        </TabsList>

        {exportScopes.map((item) => (
          <TabsPanel keepMounted key={item.value} value={item.value}>
            {/* Tabs own no panel spacing; a candidate view that renders nothing leaves no gap. */}
            {scope === item.value && item.value !== "all" ? (
              <div className="mt-4 empty:hidden">{children}</div>
            ) : null}
          </TabsPanel>
        ))}
      </TabsRoot>
    </section>
  );
}
