import { LogIn } from "lucide-react";

import type { GlobalNavItem } from "@/shared/ui/layout/GlobalNav";

export const loginNavItems = [
  { icon: <LogIn />, label: "ログイン", to: "/login" },
] as const satisfies readonly GlobalNavItem[];
