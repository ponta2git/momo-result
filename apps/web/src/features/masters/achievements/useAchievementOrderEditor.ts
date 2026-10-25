import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { useReportMasterEditStatus } from "@/features/masters/MastersEditStatus";
import { achievementKeys, invalidateAchievementReads } from "@/shared/api/achievementQueryOptions";
import { reorderAchievements } from "@/shared/api/achievements";
import type { AchievementCatalog } from "@/shared/api/achievements";
import { runIdempotentMutation } from "@/shared/api/idempotency";
import { normalizeUnknownApiError } from "@/shared/api/problemDetails";
import { useIdempotencyKeyStore } from "@/shared/api/useIdempotencyKeyStore";
import { useAuthorizationOperations, usePermissionFacts } from "@/shared/auth/useAuthorization";
import { showToast } from "@/shared/ui/feedback/Toast";

export function useAchievementOrderEditor({
  catalog,
  onClose,
}: {
  catalog: AchievementCatalog;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const authorization = useAuthorizationOperations();
  const permission = usePermissionFacts("operations");
  const idempotency = useIdempotencyKeyStore();
  const [original] = useState(catalog);
  const [items, setItems] = useState(() => catalog.items.filter((item) => !item.retiredAt));
  const [discarding, setDiscarding] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const originalItems = original.items.filter((item) => !item.retiredAt);
  const dirty = items.some(
    (item, index) => item.achievementId !== originalItems[index]?.achievementId,
  );
  const mutation = useMutation({
    mutationFn: async () => {
      const lease = authorization.begin("operations");
      if (!lease) throw new DOMException("権限を確認できません", "AbortError");
      const request = {
        gameTitleId: original.gameTitleId,
        expectedOrderRevision: original.orderRevision,
        achievementIds: [
          ...items.map((item) => item.achievementId),
          ...original.items.filter((item) => item.retiredAt).map((item) => item.achievementId),
        ],
      };
      try {
        const saved = await runIdempotentMutation(
          idempotency,
          "achievements.order",
          request,
          (options) => reorderAchievements(request, options),
        );
        if (authorization.isSameAccount(lease)) {
          queryClient.setQueryData(achievementKeys.catalog(original.gameTitleId), saved);
          void invalidateAchievementReads(queryClient, original.gameTitleId);
        }
        return authorization.canCommit(lease);
      } catch (error) {
        authorization.reportError(error, lease);
        throw error;
      }
    },
    onSuccess: (canCommit) => {
      if (!canCommit) return;
      onClose();
      showToast({ title: "表示順を保存しました", tone: "success" });
    },
  });
  useReportMasterEditStatus("achievement-order", {
    dirty,
    pending: mutation.isPending,
    discard: onClose,
  });
  const close = () => {
    if (mutation.isPending) return;
    if (dirty) setDiscarding(true);
    else onClose();
  };
  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (mutation.isPending || !permission.allowed || target < 0 || target >= items.length) return;
    const moved = items[index];
    if (!moved) return;
    const next = [...items];
    next.splice(index, 1);
    next.splice(target, 0, moved);
    setItems(next);
    setAnnouncement(`${moved.name}を${target + 1}番目へ移動しました。`);
    if (!mutation.isError || normalizeUnknownApiError(mutation.error).status !== 409)
      mutation.reset();
  };
  const problem = mutation.isError ? normalizeUnknownApiError(mutation.error) : undefined;
  const canSave = permission.allowed && dirty && !mutation.isPending && problem?.status !== 409;
  const save = () => {
    if (canSave) mutation.mutate();
  };
  return {
    items,
    permission,
    saving: mutation.isPending,
    canSave,
    save,
    discarding,
    setDiscarding,
    announcement,
    saveError: problem
      ? problem.status === 409
        ? "項目または表示順が更新されています。いったん閉じて表示を更新し、並べ替え直してください。"
        : `${problem.detail}並べ替えた順序は保持しています。`
      : null,
    close,
    move,
  };
}
