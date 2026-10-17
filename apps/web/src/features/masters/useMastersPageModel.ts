import { useMasterNavigation } from "@/features/masters/useMasterNavigation";
import { useAuthRead } from "@/shared/auth/useAuth";

/** The page subscribes to navigation and access; each retained panel owns its workflow. */
export function useMastersPageModel() {
  const auth = useAuthRead();
  const navigation = useMasterNavigation();
  return {
    openedTabs: navigation.openedTabs,
    feedback: {
      ...navigation.feedback,
      authError: auth.error,
    },
    tabs: navigation.tabs,
  } as const;
}
