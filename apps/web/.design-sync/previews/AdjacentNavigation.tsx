import { AdjacentNavigation } from "momo-result-ui";

export const BothDirections = () => (
  <AdjacentNavigation
    label="前後の試合"
    next={{ description: "第12回 第3試合・2026/10/24", href: "/matches/43", label: "後の試合" }}
    previous={{ description: "第12回 第1試合・2026/10/24", href: "/matches/41", label: "前の試合" }}
  />
);

export const AtEnd = () => (
  <AdjacentNavigation
    label="開催の前後移動"
    next={{ description: "これが最新の開催です", label: "次の開催" }}
    previous={{ description: "第11回・2026/10/17", href: "/held-events/11", label: "前の開催" }}
  />
);

export const Paused = () => (
  <AdjacentNavigation
    disabled
    label="前後の試合"
    next={{ description: "第12回 第3試合・2026/10/24", href: "/matches/43", label: "後の試合" }}
    previous={{ description: "第12回 第1試合・2026/10/24", href: "/matches/41", label: "前の試合" }}
    status={<p role="status">前後の試合を確認しています。</p>}
  />
);
