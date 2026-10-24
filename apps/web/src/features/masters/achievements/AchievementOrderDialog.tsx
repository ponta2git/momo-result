import { useLayoutEffect, useRef } from "react";

import { useAchievementOrderEditor } from "@/features/masters/achievements/useAchievementOrderEditor";
import type { AchievementCatalog } from "@/shared/api/achievements";
import { Button } from "@/shared/ui/actions/Button";
import { AlertDialog, Dialog, DialogFooter } from "@/shared/ui/feedback/Dialog";
import { Notice } from "@/shared/ui/feedback/Notice";
import { ContentWithActions } from "@/shared/ui/layout/ContentWithActions";
import { contentText } from "@/shared/ui/typography";

export function AchievementOrderDialog({
  catalog,
  onClose,
}: {
  catalog: AchievementCatalog;
  onClose: () => void;
}) {
  const {
    items,
    permission,
    mutation,
    dirty,
    discarding,
    setDiscarding,
    announcement,
    problem,
    close,
    move,
  } = useAchievementOrderEditor({ catalog, onClose });
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocus = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    if (pendingFocus.current) {
      buttons.current.get(pendingFocus.current)?.focus();
      pendingFocus.current = undefined;
    }
  });
  const moveAndFocus = (index: number, delta: number) => {
    const item = items[index];
    if (!item) return;
    const target = index + delta;
    const direction =
      target === 0 ? "down" : target === items.length - 1 ? "up" : delta < 0 ? "up" : "down";
    pendingFocus.current = `${item.achievementId}:${direction}`;
    move(index, delta);
  };
  const buttonRef = (key: string) => (node: HTMLButtonElement | null) => {
    if (node) buttons.current.set(key, node);
    else buttons.current.delete(key);
  };
  return (
    <>
      <Dialog
        open
        title="実績の表示順"
        busy={mutation.isPending}
        footer={
          <div className="grid gap-4">
            {!permission.allowed ? (
              <Notice tone="info">
                表示順を変更する権限を確認できません。変更は保持しています。
              </Notice>
            ) : null}
            {problem ? (
              <Notice tone="danger" title="表示順を保存できませんでした">
                {problem.status === 409
                  ? "項目または表示順が更新されています。いったん閉じて表示を更新し、並べ替え直してください。"
                  : `${problem.detail}並べ替えた順序は保持しています。`}
              </Notice>
            ) : null}
            <DialogFooter>
              <Button variant="secondary" disabled={mutation.isPending} onClick={close}>
                キャンセル
              </Button>
              <Button
                disabled={!permission.allowed || !dirty || problem?.status === 409}
                pending={mutation.isPending}
                pendingLabel="保存中"
                onClick={() => mutation.mutate()}
              >
                表示順を保存
              </Button>
            </DialogFooter>
          </div>
        }
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <div className="grid gap-6">
          <p className={contentText.body}>
            上へ・下へで並べ替えて保存すると、実績リストと入力候補に反映されます。
          </p>
          <ol className="grid gap-4" aria-label="実績の表示順">
            {items.map((item, index) => {
              const scope = item.common
                ? "共通"
                : item.mapMasterIds
                    .map(
                      (id) =>
                        catalog.maps.find((map) => map.mapMasterId === id)?.displayName ?? "マップ",
                    )
                    .join("・");
              const label = `${item.name}（${scope}）`;
              return (
                <li key={item.achievementId}>
                  <ContentWithActions
                    actions={
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={!permission.allowed || mutation.isPending || index === 0}
                          aria-label={`${label}を上へ`}
                          ref={buttonRef(`${item.achievementId}:up`)}
                          onClick={() => moveAndFocus(index, -1)}
                        >
                          上へ
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={
                            !permission.allowed || mutation.isPending || index === items.length - 1
                          }
                          aria-label={`${label}を下へ`}
                          ref={buttonRef(`${item.achievementId}:down`)}
                          onClick={() => moveAndFocus(index, 1)}
                        >
                          下へ
                        </Button>
                      </div>
                    }
                  >
                    <div className="grid gap-1">
                      <p className={contentText.body}>
                        <span className="mr-2 tabular-nums">{index + 1}</span>
                        {item.name}
                      </p>
                      <p className={contentText.supporting}>
                        {scope}
                        <span className="ml-2" aria-label={`星${item.stars}`}>
                          {"★".repeat(item.stars)}
                        </span>
                      </p>
                    </div>
                  </ContentWithActions>
                </li>
              );
            })}
          </ol>
          <p className="sr-only" role="status">
            {announcement}
          </p>
        </div>
      </Dialog>
      <AlertDialog
        open={discarding}
        title="未保存の表示順を破棄しますか？"
        confirmLabel="破棄して閉じる"
        onOpenChange={setDiscarding}
        onConfirm={onClose}
      />
    </>
  );
}
