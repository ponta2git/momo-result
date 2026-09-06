import { useId } from "react";
import type { ReactNode } from "react";

import { cn } from "@/shared/ui/cn";
import { TabsList, TabsPanel, TabsRoot, TabsTab } from "@/shared/ui/forms/Tabs";
import { contentText } from "@/shared/ui/typography";

import type { ExportScope } from "./exportTypes";
import { exportScopes } from "./exportViewModel";

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
    <section aria-labelledby={headingId}>
      <h2 className={cn(contentText.heading, "mb-2")} id={headingId}>
        出力範囲
      </h2>
      <p className={cn(contentText.body, "mb-3 text-pretty")}>{exportExclusionNotice}</p>
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
            {scope === item.value && item.value !== "all" ? (
              <div className="mt-4">{children}</div>
            ) : null}
          </TabsPanel>
        ))}
      </TabsRoot>
    </section>
  );
}
