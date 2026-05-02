import { Home, List, ScanText, Settings } from "lucide-react";
import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";

import { cn } from "@/shared/ui/cn";

type NavItem = {
  icon: ReactNode;
  label: string;
  to: string;
};

const defaultItems: NavItem[] = [
  { icon: <Home className="size-4" />, label: "ホーム", to: "/matches" },
  { icon: <ScanText className="size-4" />, label: "OCR登録", to: "/ocr/new" },
  { icon: <List className="size-4" />, label: "出力", to: "/exports" },
  { icon: <Settings className="size-4" />, label: "マスタ", to: "/admin/masters" },
];

type GlobalNavProps = {
  className?: string;
  items?: NavItem[];
};

export function GlobalNav({ className, items = defaultItems }: GlobalNavProps) {
  return (
    <nav
      className={cn(
        "sticky top-0 z-[var(--z-sticky)] border-b border-[var(--color-border)] bg-[var(--color-surface)]",
        className,
      )}
    >
      <div className="mx-auto flex w-full max-w-[75rem] min-w-0 flex-wrap items-center gap-2 px-3 py-2 sm:px-4">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cn(
                "inline-flex min-h-10 items-center gap-2 rounded-[var(--radius-sm)] border px-3 py-1.5 text-sm font-semibold transition-colors duration-150",
                isActive
                  ? "border-[var(--color-action)]/60 bg-[var(--color-action)]/12 text-[var(--color-text-primary)]"
                  : "border-transparent text-[var(--color-text-secondary)] hover:border-[var(--color-border)] hover:bg-[var(--color-surface-subtle)]",
              )
            }
          >
            <span aria-hidden="true">{item.icon}</span>
            <span>{item.label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
