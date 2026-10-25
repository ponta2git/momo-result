import { Camera, ClipboardList, Download } from "lucide-react";
import { IconLink } from "momo-result-ui";

export const RowActions = () => (
  <div className="flex flex-wrap items-center gap-1">
    <IconLink
      aria-label="2026/10/24 の開催にOCR取り込み"
      icon={<Camera />}
      to="/held-events/12/ocr"
      tooltip="この開催にOCR取り込み"
    />
    <IconLink
      aria-label="2026/10/24 の開催詳細"
      icon={<ClipboardList />}
      to="/held-events/12"
      tooltip="開催結果を見る"
    />
    <IconLink
      aria-label="2026/10/24 をCSV出力"
      icon={<Download />}
      to="/exports?heldEventId=12&format=csv"
      tooltip="CSV/TSV出力へ"
    />
  </div>
);

export const Variants = () => (
  <div className="flex flex-wrap items-center gap-2">
    <IconLink
      aria-label="開催結果を見る"
      icon={<ClipboardList />}
      to="/held-events/12"
      variant="secondary"
    />
    <IconLink
      aria-label="開催結果を見る"
      icon={<ClipboardList />}
      to="/held-events/12"
      variant="quiet"
    />
  </div>
);

export const Sizes = () => (
  <div className="flex flex-wrap items-center gap-2">
    <IconLink aria-label="CSV出力" icon={<Download />} size="sm" to="/exports" />
    <IconLink aria-label="CSV出力" icon={<Download />} size="md" to="/exports" />
    <IconLink aria-label="CSV出力" icon={<Download />} size="lg" to="/exports" />
  </div>
);

export const Disabled = () => (
  <IconLink
    aria-label="2026/10/24 の開催にOCR取り込み"
    disabled
    icon={<Camera />}
    to="/held-events/12/ocr"
  />
);
