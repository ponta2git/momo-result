import { TableScrollArea } from "momo-result-ui";

const players = ["ももたろう", "きんたろう", "うらしま", "かぐや"];
const seasons = Array.from({ length: 12 }, (_, index) => `第${index + 1}回`);
const assets = [
  [128, 97, 64, 31, 112, 88, 140, 76, 59, 133, 101, 92],
  [97, 128, 31, 64, 88, 112, 76, 140, 133, 59, 92, 101],
  [64, 31, 128, 97, 59, 133, 92, 101, 112, 88, 140, 76],
  [31, 64, 97, 128, 133, 59, 101, 92, 88, 76, 112, 140],
];

const cell = "border-b border-[var(--color-border)] px-3 py-2 text-sm whitespace-nowrap";

const AssetTable = ({ rows = players }: { rows?: string[] }) => (
  <table className="min-w-full" style={{ borderCollapse: "collapse" }}>
    <thead>
      <tr className="bg-[var(--color-surface-subtle)] text-left">
        <th className={`${cell} font-structure`} scope="col">
          プレイヤー
        </th>
        {seasons.map((season) => (
          <th className={`${cell} font-structure text-right`} key={season} scope="col">
            {season}
          </th>
        ))}
      </tr>
    </thead>
    <tbody>
      {rows.map((player, rowIndex) => (
        <tr key={`${player}-${rowIndex}`}>
          <th className={`${cell} font-plain text-left`} scope="row">
            {player}
          </th>
          {(assets[rowIndex % assets.length] ?? []).map((value, index) => (
            <td className={`${cell} text-right tabular-nums`} key={seasons[index]}>
              {(value * 1000).toLocaleString("ja-JP")}万円
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  </table>
);

export const HorizontalOverflow = () => (
  <TableScrollArea label="回ごとの総資産">
    <AssetTable />
  </TableScrollArea>
);

export const BothDirections = () => (
  <TableScrollArea label="回ごとの総資産（全員分）" maxHeight="10rem">
    <AssetTable rows={[...players, ...players]} />
  </TableScrollArea>
);

export const FitsWithoutHint = () => (
  <TableScrollArea label="最終順位">
    <table className="min-w-full" style={{ borderCollapse: "collapse" }}>
      <thead>
        <tr className="bg-[var(--color-surface-subtle)] text-left">
          <th className={`${cell} font-structure`} scope="col">
            順位
          </th>
          <th className={`${cell} font-structure`} scope="col">
            プレイヤー
          </th>
        </tr>
      </thead>
      <tbody>
        {players.map((player, index) => (
          <tr key={player}>
            <td className={`${cell} tabular-nums`}>{index + 1}位</td>
            <th className={`${cell} font-plain text-left`} scope="row">
              {player}
            </th>
          </tr>
        ))}
      </tbody>
    </table>
  </TableScrollArea>
);
