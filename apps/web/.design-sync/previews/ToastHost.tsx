import { ToastHost, showToast } from "momo-result-ui";
import { useEffect } from "react";

export const Stack = () => {
  useEffect(() => {
    showToast({
      id: "preview-saved",
      timeout: 0,
      title: "試合結果を保存しました",
      tone: "success",
    });
    showToast({
      description: "第12回 桃鉄リーグの順位表に反映されるまで数分かかります。",
      id: "preview-recalc",
      timeout: 0,
      title: "再計算を予約しました",
      tone: "info",
    });
    showToast({
      description: "通信を確認して、もう一度お試しください。",
      id: "preview-failed",
      timeout: 0,
      title: "開催を削除できませんでした",
      tone: "danger",
    });
  }, []);
  return (
    <div className="min-h-64">
      <ToastHost />
    </div>
  );
};
