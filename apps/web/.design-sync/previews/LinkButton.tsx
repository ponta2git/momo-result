import { ArrowLeft, Download, Trophy } from "lucide-react";
import { LinkButton } from "momo-result-ui";

export const Variants = () => (
  <div className="flex flex-wrap items-center gap-2">
    <LinkButton to="/matches">試合一覧を開く</LinkButton>
    <LinkButton to="/held-events" variant="secondary">
      開催一覧へ
    </LinkButton>
    <LinkButton to="/achievements" variant="quiet">
      実績を見る
    </LinkButton>
    <LinkButton to="/matches/42/delete" variant="danger">
      削除画面へ
    </LinkButton>
    <LinkButton to="/matches/42/revert" variant="dangerQuiet">
      取り消し手順へ
    </LinkButton>
  </div>
);

export const Sizes = () => (
  <div className="flex flex-wrap items-center gap-2">
    <LinkButton size="sm" to="/achievements" variant="secondary">
      小
    </LinkButton>
    <LinkButton size="md" to="/achievements" variant="secondary">
      中
    </LinkButton>
    <LinkButton size="lg" to="/achievements" variant="secondary">
      大
    </LinkButton>
  </div>
);

export const WithIcon = () => (
  <div className="flex flex-wrap items-center gap-2">
    <LinkButton icon={<ArrowLeft aria-hidden="true" />} to="/held-events" variant="quiet">
      開催一覧に戻る
    </LinkButton>
    <LinkButton
      icon={<Trophy aria-hidden="true" />}
      size="sm"
      to="/achievements?player=momotaro"
      variant="secondary"
    >
      ももたろうの実績
    </LinkButton>
    <LinkButton href="/exports/held-event-12.csv" icon={<Download aria-hidden="true" />}>
      CSVをダウンロード
    </LinkButton>
  </div>
);

export const States = () => (
  <div className="flex flex-wrap items-center gap-2">
    <LinkButton pending pendingLabel="準備中…" to="/exports">
      出力画面へ
    </LinkButton>
    <LinkButton disabled to="/held-events/13" variant="secondary">
      第13回（未開催）
    </LinkButton>
  </div>
);
