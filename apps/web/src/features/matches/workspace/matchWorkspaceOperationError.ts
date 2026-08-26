export type MatchWorkspaceOperationErrorKind =
  | "cancelDraft"
  | "confirm"
  | "draftStatus"
  | "heldEventCreation"
  | "update";

export type MatchWorkspaceOperationError = {
  kind: MatchWorkspaceOperationErrorKind;
  message: string;
};

export type MatchWorkspaceOperationErrorView = {
  detail: string;
  nextStep: string;
  title: string;
};

export function toMatchWorkspaceOperationErrorView(
  error: MatchWorkspaceOperationError,
): MatchWorkspaceOperationErrorView {
  switch (error.kind) {
    case "heldEventCreation":
      return {
        detail: error.message,
        nextStep:
          "開催履歴は追加されておらず、試合条件も変更していません。通信状態と開催日時を確認して、もう一度作成してください。",
        title: "開催履歴を追加できませんでした",
      };
    case "update":
      return {
        detail: error.message,
        nextStep: "入力内容は保持しています。内容と通信状態を確認して、もう一度保存してください。",
        title: "変更を保存できませんでした",
      };
    case "cancelDraft":
      return {
        detail: error.message,
        nextStep:
          "確定前の記録と入力内容は残っています。通信状態を確認して、もう一度削除してください。",
        title: "確定前の記録を削除できませんでした",
      };
    case "draftStatus":
      return {
        detail: error.message,
        nextStep: "入力内容は保持しています。通信状態を確認して、もう一度確定を実行してください。",
        title: "確定前の記録の状態を確認できませんでした",
      };
    case "confirm":
      return {
        detail: error.message,
        nextStep: "入力内容は保持しています。内容と通信状態を確認して、もう一度確定してください。",
        title: "試合を確定できませんでした",
      };
  }
}
