import { useId } from "react";
import type { ReactNode } from "react";

import { TabsList, TabsPanel, TabsRoot, TabsTab } from "@/shared/ui/forms/Tabs";
import { contentText } from "@/shared/ui/typography";

import { exportFormats } from "./exportPresentation";
import type { ExportFormat } from "./exportTypes";

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
    <section aria-labelledby={headingId} className="grid gap-2">
      <h2 className={contentText.heading} id={headingId}>
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
            {/* The download action stays mounted while hidden; its empty slot keeps no gap. */}
            {format === item.value ? <div className="mt-4 empty:hidden">{children}</div> : null}
          </TabsPanel>
        ))}
      </TabsRoot>
    </section>
  );
}
