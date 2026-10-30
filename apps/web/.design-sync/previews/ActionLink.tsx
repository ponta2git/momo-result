import { ActionLink, buttonClassName } from "momo-result-ui";

export const RouterLinks = () => (
  <div className="flex flex-wrap items-center gap-2">
    <ActionLink className={buttonClassName({ variant: "primary" })} to="/matches/new">
      試合を登録
    </ActionLink>
    <ActionLink className={buttonClassName({ variant: "secondary" })} to="/held-events">
      開催一覧へ
    </ActionLink>
    <ActionLink className={buttonClassName({ variant: "quiet" })} to="/matches">
      試合一覧に戻る
    </ActionLink>
  </div>
);

export const ExternalHref = () => (
  <ActionLink
    className={buttonClassName({ size: "sm", variant: "secondary" })}
    href="/exports/held-event-12.csv"
  >
    第12回の結果をCSVで保存
  </ActionLink>
);

export const Unavailable = () => (
  <div className="flex flex-wrap items-center gap-2">
    <ActionLink
      className={buttonClassName({ disabled: true, variant: "secondary" })}
      disabled
      to="/held-events/13"
    >
      第13回（未開催）
    </ActionLink>
    <ActionLink
      className={buttonClassName({ disabled: true, variant: "primary" })}
      pending
      to="/matches/42"
    >
      試合を開いています…
    </ActionLink>
  </div>
);
