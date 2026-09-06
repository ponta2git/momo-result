import { useId } from "react";
import type { ReactNode } from "react";

import { cn } from "@/shared/ui/cn";
import { TabsList, TabsPanel, TabsRoot, TabsTab } from "@/shared/ui/forms/Tabs";
import { contentText } from "@/shared/ui/typography";

import type { ExportFormat } from "./exportTypes";
import { exportFormats } from "./exportViewModel";

type ExportFormatTabsProps = {
  children: ReactNode;
  disabled?: boolean;
  format: ExportFormat;
  onChange: (format: ExportFormat) => void;
};

function isExportFormat(value: unknown): value is ExportFormat {
  return exportFormats.some((format) => format.value === value);
}

export function ExportFormatTabs({
  children,
  disabled = false,
  format,
  onChange,
}: ExportFormatTabsProps) {
  const headingId = useId();

  return (
    <section aria-labelledby={headingId}>
      <h2 className={cn(contentText.heading, "mb-2")} id={headingId}>
        ファイル形式
      </h2>
      <TabsRoot
        value={format}
        onValueChange={(value) => {
          if (isExportFormat(value)) onChange(value);
        }}
      >
        <TabsList activateOnFocus aria-labelledby={headingId}>
          {exportFormats.map((item) => (
            <TabsTab disabled={disabled} key={item.value} value={item.value}>
              {item.label}
            </TabsTab>
          ))}
        </TabsList>

        {exportFormats.map((item) => (
          <TabsPanel keepMounted key={item.value} value={item.value}>
            {format === item.value && children ? <div className="mt-4">{children}</div> : null}
          </TabsPanel>
        ))}
      </TabsRoot>
    </section>
  );
}
