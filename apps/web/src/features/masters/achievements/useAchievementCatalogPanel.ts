import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { useReportMasterEditStatus } from "@/features/masters/MastersEditStatus";
import {
  achievementCatalogQueryOptions,
  achievementKeys,
  invalidateAchievementReads,
} from "@/shared/api/achievementQueryOptions";
import { createAchievement, retireAchievement, updateAchievement } from "@/shared/api/achievements";
import type {
  AchievementCatalog,
  AchievementItem,
  CreateAchievementRequest,
  UpdateAchievementRequest,
} from "@/shared/api/achievements";
import { runIdempotentMutation } from "@/shared/api/idempotency";
import { normalizeUnknownApiError } from "@/shared/api/problemDetails";
import { gameTitlesQueryOptions } from "@/shared/api/queryOptions";
import { useIdempotencyKeyStore } from "@/shared/api/useIdempotencyKeyStore";
import { useAuthorizationOperations, usePermissionFacts } from "@/shared/auth/useAuthorization";
import { showToast } from "@/shared/ui/feedback/Toast";

type ItemForm = {
  name: string;
  notes: string;
  stars: string;
  common: boolean;
  mapMasterIds: string[];
  ruleKind: string;
  threshold: string;
};
function itemForm(item?: AchievementItem): ItemForm {
  return {
    name: item?.name ?? "",
    notes: item?.notes ?? "",
    stars: String(item?.stars ?? 1),
    common: item?.common ?? true,
    mapMasterIds: item?.mapMasterIds ?? [],
    ruleKind: item?.ruleKind ?? "manual",
    threshold: item?.threshold ?? "",
  };
}

type SaveItem =
  | { gameTitleId: string; kind: "create"; request: CreateAchievementRequest }
  | {
      gameTitleId: string;
      kind: "update";
      achievementId: string;
      request: UpdateAchievementRequest;
    }
  | { gameTitleId: string; kind: "retire"; achievementId: string; expectedVersion: string };

export function useAchievementCatalogPanel({ enabled }: { enabled: boolean }) {
  const queryClient = useQueryClient();
  const permission = usePermissionFacts("operations");
  const authorization = useAuthorizationOperations();
  const idempotency = useIdempotencyKeyStore();
  const [selection, setSelection] = useState("");
  const [editor, setEditor] = useState<{
    item?: AchievementItem;
    gameTitleId: string;
    form: ItemForm;
  }>();
  const [retiring, setRetiring] = useState<AchievementItem>();
  const [discarding, setDiscarding] = useState(false);
  const [validation, setValidation] = useState("");
  const titles = useQuery({ ...gameTitlesQueryOptions(), enabled: enabled && permission.allowed });
  const gameTitleId = selection || titles.data?.items?.[0]?.id;
  const catalog = useQuery(
    achievementCatalogQueryOptions(gameTitleId, enabled && permission.allowed),
  );
  const mutation = useMutation({
    mutationFn: async (command: SaveItem) => {
      const lease = authorization.begin("operations");
      if (!lease) throw new DOMException("権限を確認できません", "AbortError");
      try {
        const saved =
          command.kind === "create"
            ? await runIdempotentMutation(
                idempotency,
                "achievements.create",
                command.request,
                (options) => createAchievement(command.request, options),
              )
            : command.kind === "update"
              ? await runIdempotentMutation(
                  idempotency,
                  "achievements.update",
                  command,
                  (options) => updateAchievement(command.achievementId, command.request, options),
                )
              : await runIdempotentMutation(
                  idempotency,
                  "achievements.retire",
                  command,
                  (options) =>
                    retireAchievement(
                      command.achievementId,
                      { expectedVersion: command.expectedVersion },
                      options,
                    ),
                );
        if (authorization.isSameAccount(lease)) {
          queryClient.setQueryData<AchievementCatalog>(
            achievementKeys.catalog(command.gameTitleId),
            (current) =>
              current
                ? {
                    ...current,
                    items: current.items.some((item) => item.achievementId === saved.achievementId)
                      ? current.items.map((item) =>
                          item.achievementId === saved.achievementId ? saved : item,
                        )
                      : [...current.items, saved],
                  }
                : current,
          );
          void invalidateAchievementReads(queryClient, command.gameTitleId);
        }
        return { saved, canCommit: authorization.canCommit(lease) };
      } catch (error) {
        authorization.reportError(error, lease);
        if (normalizeUnknownApiError(error).status === 409)
          void queryClient.invalidateQueries({
            queryKey: achievementKeys.catalog(command.gameTitleId),
          });
        throw error;
      }
    },
  });
  const dirty = Boolean(
    editor && JSON.stringify(editor.form) !== JSON.stringify(itemForm(editor.item)),
  );
  const discardEditor = () => {
    if (mutation.isPending) return;
    setEditor(undefined);
    setDiscarding(false);
  };
  useReportMasterEditStatus("achievements", {
    dirty,
    pending: mutation.isPending,
    discard: discardEditor,
  });
  const currentItem =
    editor?.item &&
    catalog.data?.items.find((item) => item.achievementId === editor.item?.achievementId);
  const conflict = Boolean(editor?.item && currentItem?.version !== editor.item.version);
  const closeEditor = () => {
    if (mutation.isPending) return;
    if (dirty) setDiscarding(true);
    else discardEditor();
  };
  const updateForm = (change: Partial<ItemForm>) =>
    setEditor((current) =>
      current ? { ...current, form: { ...current.form, ...change } } : current,
    );
  const startEditor = (achievementId?: string) => {
    if (!gameTitleId || mutation.isPending || !permission.allowed) return;
    const item = catalog.data?.items.find((value) => value.achievementId === achievementId);
    if (achievementId && !item) return;
    mutation.reset();
    setValidation("");
    setEditor({ ...(item ? { item } : {}), gameTitleId, form: itemForm(item) });
  };
  const save = async () => {
    if (!editor || mutation.isPending || conflict || !permission.allowed) return;
    const form = editor.form;
    if (!form.name.trim()) {
      setValidation("達成内容を入力してください。");
      return;
    }
    if (Array.from(form.name).length > 300 || Array.from(form.notes).length > 4000) {
      setValidation("達成内容は300字以内、備考は4000字以内で入力してください。");
      return;
    }
    if (!editor.item && !form.common && form.mapMasterIds.length === 0) {
      setValidation("対象マップを1つ以上選択してください。");
      return;
    }
    if (!editor.item && form.ruleKind !== "manual") {
      const number = Number(form.threshold);
      const integerRule = form.ruleKind !== "event_average_rank";
      if (
        !form.threshold.trim() ||
        !Number.isFinite(number) ||
        (integerRule && (!Number.isInteger(number) || number < 1 || number > 2_147_483_647)) ||
        (form.ruleKind === "event_average_rank" && (number < 1 || number > 4))
      ) {
        setValidation(
          form.ruleKind === "event_average_rank"
            ? "平均順位の閾値は1〜4の数値で入力してください。"
            : "閾値は1〜2,147,483,647の整数で入力してください。",
        );
        return;
      }
    }
    setValidation("");
    const shared = { name: form.name.trim(), notes: form.notes.trim(), stars: Number(form.stars) };
    const result = await mutation.mutateAsync(
      editor.item
        ? {
            kind: "update",
            gameTitleId: editor.gameTitleId,
            achievementId: editor.item.achievementId,
            request: { ...shared, expectedVersion: editor.item.version },
          }
        : {
            kind: "create",
            gameTitleId: editor.gameTitleId,
            request: {
              ...shared,
              gameTitleId: editor.gameTitleId,
              common: form.common,
              mapMasterIds: form.common ? [] : form.mapMasterIds,
              ruleKind: form.ruleKind,
              threshold: form.ruleKind === "manual" ? null : form.threshold.trim(),
            },
          },
    );
    if (result.canCommit) {
      setEditor(undefined);
      showToast({ title: "実績項目を保存しました", tone: "success" });
    }
  };
  const items = catalog.data?.items.filter((item) => !item.retiredAt) ?? [];
  const retiredItems = catalog.data?.items.filter((item) => item.retiredAt) ?? [];
  const startRetirement = (achievementId: string) => {
    if (mutation.isPending || !permission.allowed) return;
    const item = catalog.data?.items.find((value) => value.achievementId === achievementId);
    if (!item) return;
    mutation.reset();
    setRetiring(item);
  };
  const retire = async () => {
    if (!retiring || mutation.isPending || !permission.allowed) return;
    const result = await mutation.mutateAsync({
      kind: "retire",
      gameTitleId: retiring.gameTitleId,
      achievementId: retiring.achievementId,
      expectedVersion: retiring.version,
    });
    if (result.canCommit) {
      setRetiring(undefined);
      showToast({ title: "実績項目を廃止しました", tone: "success" });
    }
  };
  const refresh = () => {
    if (!permission.allowed) return;
    void Promise.all([titles.refetch(), catalog.refetch()]).catch(() => undefined);
  };

  return {
    gameTitleId,
    changeTitle: (value: string) => setSelection(value),
    editor,
    discardEditor,
    retiring,
    closeRetirement: () => {
      if (!mutation.isPending) setRetiring(undefined);
    },
    discarding,
    setDiscarding,
    validation,
    titles: titles.data?.items ?? [],
    catalog: catalog.data,
    loading: titles.isLoading || catalog.isLoading,
    refreshing: titles.isFetching || catalog.isFetching,
    canReorder:
      permission.allowed && Boolean(catalog.data) && !catalog.isFetching && items.length > 1,
    readFailed: titles.isError || catalog.isError,
    saving: mutation.isPending,
    saveError: mutation.isError ? normalizeUnknownApiError(mutation.error).detail : null,
    permission,
    conflict,
    dirty,
    items,
    retiredItems,
    save,
    closeEditor,
    updateForm,
    startEditor,
    startRetirement,
    retire,
    refresh,
  };
}
