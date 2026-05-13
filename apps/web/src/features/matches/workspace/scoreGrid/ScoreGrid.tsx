import { useCallback, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import { incidentColumns } from "@/features/matches/workspace/matchFormTypes";
import type {
  IncidentKey,
  MatchFormValues,
  OriginalPlayerSnapshot,
} from "@/features/matches/workspace/matchFormTypes";
import { handleScoreGridKeydown } from "@/features/matches/workspace/scoreGrid/ScoreGridKeyboard";
import { ScoreGridNumericEditor } from "@/features/matches/workspace/scoreGrid/ScoreGridNumericEditor";
import type {
  IncidentNumericCommit,
  PlayerNumericCommit,
} from "@/features/matches/workspace/scoreGrid/ScoreGridNumericEditor";
import { fixedMembers, memberDisplayName } from "@/shared/domain/members";
import { useMediaQuery } from "@/shared/lib/useMediaQuery";

type GridColumn =
  | "memberId"
  | "playOrder"
  | "rank"
  | "totalAssetsManYen"
  | "revenueManYen"
  | `incident.${IncidentKey}`;

const gridColumns: GridColumn[] = [
  "memberId",
  "playOrder",
  "rank",
  "totalAssetsManYen",
  "revenueManYen",
  ...incidentColumns.map(([key]) => `incident.${key}` as const),
];

const baseInputClass =
  "w-full min-w-0 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-2 text-sm text-[var(--color-text-primary)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)]";
const textNumericShortClass = `${baseInputClass} min-w-[6ch] text-center tabular-nums`;
const textNumericClass = `${baseInputClass} min-w-[12ch] text-right tabular-nums`;
const selectShortClass = `${baseInputClass} min-w-[6ch] text-center`;
const memberSelectClass = `${baseInputClass} min-w-[10rem]`;

function keyToPath(row: number, column: GridColumn): string {
  if (column.startsWith("incident.")) {
    return `players.${row}.incidents.${column.replace("incident.", "")}`;
  }
  return `players.${row}.${column}`;
}

type ScoreGridProps = {
  errorPathSet: Set<string>;
  lastSyncedPlayerIndex: number | null;
  onIncidentChange: (index: number, key: IncidentKey, value: number) => void;
  onPlayerChange: (index: number, patch: Partial<MatchFormValues["players"][number]>) => void;
  onPlayOrderChange: (index: number, playOrder: number) => void;
  onPreferImageKindChange?: (kind: "incident_log" | "revenue" | "total_assets") => void;
  onRequestSubmitFocus: () => void;
  originalPlayers: OriginalPlayerSnapshot[] | undefined;
  players: MatchFormValues["players"];
};

export function ScoreGrid({
  errorPathSet,
  lastSyncedPlayerIndex,
  onIncidentChange,
  onPlayerChange,
  onPlayOrderChange,
  onPreferImageKindChange,
  onRequestSubmitFocus,
  originalPlayers,
  players,
}: ScoreGridProps) {
  const [expandedMobilePlayer, setExpandedMobilePlayer] = useState(0);
  const isNarrowViewport = useMediaQuery("(max-width: 1023px)");
  const inputRefs = useRef(new Map<string, HTMLElement>());

  const originalByPlayOrder = useMemo(() => {
    if (!originalPlayers) {
      return new Map<number, OriginalPlayerSnapshot>();
    }
    return new Map(originalPlayers.map((player) => [player.playOrder, player]));
  }, [originalPlayers]);

  const getCellId = useCallback(
    (row: number, col: number) => `player-${row}-${gridColumns[col]}`,
    [],
  );

  const registerCellRef = useCallback((cellId: string, node: HTMLElement | null) => {
    if (node) {
      inputRefs.current.set(cellId, node);
    } else {
      inputRefs.current.delete(cellId);
    }
  }, []);

  const focusCell = useCallback((cellId: string) => {
    const next = inputRefs.current.get(cellId);
    if (next) {
      next.focus();
    }
  }, []);

  const handleKeyboard = useCallback(
    (args: {
      col: number;
      event: KeyboardEvent<HTMLElement>;
      onRevertCell: () => void;
      row: number;
    }) => {
      const target = args.event.currentTarget;

      if (args.event.key === "ArrowLeft" || args.event.key === "ArrowRight") {
        const delta = args.event.key === "ArrowLeft" ? -1 : 1;
        const nextCol = args.col + delta;
        if (nextCol >= 0 && nextCol < gridColumns.length) {
          const isSelect = target instanceof HTMLSelectElement;
          const isInputSelectedAll =
            target instanceof HTMLInputElement &&
            target.selectionStart === 0 &&
            target.selectionEnd === target.value.length;

          if (isSelect || isInputSelectedAll) {
            args.event.preventDefault();
            focusCell(getCellId(args.row, nextCol));
            return;
          }
        }
      }

      handleScoreGridKeydown({
        colCount: gridColumns.length,
        event: args.event,
        getCellId: ({ col, row }) => getCellId(row, col),
        horizontalEnterFromCol: 5,
        onFocusCell: focusCell,
        onRevertCell: args.onRevertCell,
        onSubmitFocus: onRequestSubmitFocus,
        position: { col: args.col, row: args.row },
        rowCount: players.length,
      });
    },
    [focusCell, getCellId, onRequestSubmitFocus, players.length],
  );

  const handlePlayerNumericCommit = useCallback<PlayerNumericCommit>(
    (index, field, value) =>
      onPlayerChange(index, { [field]: value } as Partial<MatchFormValues["players"][number]>),
    [onPlayerChange],
  );

  const handleIncidentNumericCommit = useCallback<IncidentNumericCommit>(
    (index, key, value) => onIncidentChange(index, key, value),
    [onIncidentChange],
  );

  const grid = (
    <table className="min-w-[64rem] table-fixed border-separate border-spacing-y-2 text-left text-sm">
      <colgroup>
        <col className="w-[10rem]" />
        <col className="w-[7ch]" />
        <col className="w-[7ch]" />
        <col className="w-[12ch]" />
        <col className="w-[12ch]" />
        {incidentColumns.map(([, label]) => (
          <col key={label} className="w-[7ch]" />
        ))}
      </colgroup>
      <thead className="text-xs text-[var(--color-text-secondary)]">
        <tr>
          <th className="sticky left-0 z-[var(--z-dropdown)] bg-[var(--color-surface)] px-2 py-2">
            メンバー
          </th>
          <th className="px-2 py-2">順</th>
          <th className="px-2 py-2">順位</th>
          <th className="px-2 py-2">総資産</th>
          <th className="px-2 py-2">収益</th>
          {incidentColumns.map(([, label]) => (
            <th key={label} className="px-2 py-2">
              {label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {players.map((player, rowIndex) => {
          const originalRow = originalPlayers?.[rowIndex];
          const originalByOrder = originalByPlayOrder.get(player.playOrder);
          return (
            <tr key={player.memberId} className="bg-[var(--color-surface-subtle)]">
              <td className="sticky left-0 z-[var(--z-sticky)] rounded-l-[var(--radius-md)] bg-[var(--color-surface-subtle)] px-2 py-3 align-top">
                <select
                  ref={(node) => {
                    const cellId = getCellId(rowIndex, 0);
                    if (node) {
                      inputRefs.current.set(cellId, node);
                    } else {
                      inputRefs.current.delete(cellId);
                    }
                  }}
                  aria-label={`${memberDisplayName(player.memberId)} memberId`}
                  className={memberSelectClass}
                  value={player.memberId}
                  onChange={(event) => {
                    onPlayerChange(rowIndex, {
                      memberId: event.target
                        .value as MatchFormValues["players"][number]["memberId"],
                    });
                  }}
                  onKeyDown={(event) =>
                    handleKeyboard({
                      col: 0,
                      event,
                      onRevertCell: () => undefined,
                      row: rowIndex,
                    })
                  }
                >
                  {fixedMembers.map((member) => (
                    <option key={member.memberId} value={member.memberId}>
                      {member.displayName}
                    </option>
                  ))}
                </select>
              </td>

              <td className="px-2 py-3 align-top">
                {(() => {
                  const cellId = getCellId(rowIndex, 1);
                  return (
                    <select
                      ref={(node) => {
                        if (node) {
                          inputRefs.current.set(cellId, node);
                        } else {
                          inputRefs.current.delete(cellId);
                        }
                      }}
                      aria-label={`${memberDisplayName(player.memberId)} playOrder`}
                      className={`${selectShortClass} ${
                        errorPathSet.has(keyToPath(rowIndex, "playOrder"))
                          ? "border-[var(--color-danger)]/65 bg-[var(--color-danger)]/10"
                          : ""
                      }`}
                      value={Number.isFinite(player.playOrder) ? String(player.playOrder) : ""}
                      onChange={(event) =>
                        onPlayOrderChange(rowIndex, Number.parseInt(event.target.value, 10))
                      }
                      onFocus={() => onPreferImageKindChange?.("incident_log")}
                      onKeyDown={(event) =>
                        handleKeyboard({
                          col: 1,
                          event,
                          onRevertCell: () => undefined,
                          row: rowIndex,
                        })
                      }
                    >
                      <option value="">-</option>
                      {[1, 2, 3, 4].map((order) => (
                        <option key={order} value={order}>
                          {order}
                        </option>
                      ))}
                    </select>
                  );
                })()}
              </td>

              <td className="px-2 py-3 align-top">
                <ScoreGridNumericEditor
                  allowSign={false}
                  ariaLabel={`${memberDisplayName(player.memberId)} rank`}
                  baseClassName={textNumericShortClass}
                  cellId={getCellId(rowIndex, 2)}
                  col={2}
                  commitKind="player"
                  error={errorPathSet.has(keyToPath(rowIndex, "rank"))}
                  field="rank"
                  originalValue={originalRow?.rank}
                  registerCellRef={registerCellRef}
                  row={rowIndex}
                  showStateLabel
                  value={player.rank}
                  onKeyboard={handleKeyboard}
                  onPlayerCommit={handlePlayerNumericCommit}
                />
              </td>

              <td className="px-2 py-3 align-top">
                <ScoreGridNumericEditor
                  allowSign
                  ariaLabel={`${memberDisplayName(player.memberId)} totalAssetsManYen`}
                  baseClassName={textNumericClass}
                  cellId={getCellId(rowIndex, 3)}
                  col={3}
                  commitKind="player"
                  error={errorPathSet.has(keyToPath(rowIndex, "totalAssetsManYen"))}
                  focusImageKind="total_assets"
                  field="totalAssetsManYen"
                  originalValue={originalRow?.totalAssetsManYen}
                  registerCellRef={registerCellRef}
                  row={rowIndex}
                  showStateLabel
                  value={player.totalAssetsManYen}
                  onKeyboard={handleKeyboard}
                  onPlayerCommit={handlePlayerNumericCommit}
                  onPreferImageKindChange={onPreferImageKindChange}
                />
              </td>

              <td className="px-2 py-3 align-top">
                <ScoreGridNumericEditor
                  allowSign
                  ariaLabel={`${memberDisplayName(player.memberId)} revenueManYen`}
                  baseClassName={textNumericClass}
                  cellId={getCellId(rowIndex, 4)}
                  col={4}
                  commitKind="player"
                  error={errorPathSet.has(keyToPath(rowIndex, "revenueManYen"))}
                  focusImageKind="revenue"
                  field="revenueManYen"
                  originalValue={originalRow?.revenueManYen}
                  registerCellRef={registerCellRef}
                  row={rowIndex}
                  showStateLabel
                  value={player.revenueManYen}
                  onKeyboard={handleKeyboard}
                  onPlayerCommit={handlePlayerNumericCommit}
                  onPreferImageKindChange={onPreferImageKindChange}
                />
              </td>

              {incidentColumns.map(([incidentKey, incidentLabel], incidentIndex) => {
                const col = incidentIndex + 5;
                const cellId = getCellId(rowIndex, col);
                return (
                  <td
                    key={incidentKey}
                    className="px-2 py-3 align-top last:rounded-r-[var(--radius-md)]"
                  >
                    <ScoreGridNumericEditor
                      allowSign={false}
                      ariaLabel={`${memberDisplayName(player.memberId)} ${incidentKey}`}
                      baseClassName={textNumericShortClass}
                      cellId={cellId}
                      col={col}
                      commitKind="incident"
                      error={errorPathSet.has(
                        keyToPath(rowIndex, `incident.${incidentKey}` as GridColumn),
                      )}
                      focusImageKind="incident_log"
                      incidentKey={incidentKey}
                      originalValue={originalByOrder?.incidents[incidentLabel]}
                      registerCellRef={registerCellRef}
                      row={rowIndex}
                      showStateLabel
                      synced={lastSyncedPlayerIndex === rowIndex}
                      value={player.incidents[incidentKey]}
                      onIncidentCommit={handleIncidentNumericCommit}
                      onKeyboard={handleKeyboard}
                      onPreferImageKindChange={onPreferImageKindChange}
                    />
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-[var(--color-text-primary)]">
            4人分の結果を確認・修正
          </h2>
          <p className="mt-1 text-sm text-pretty text-[var(--color-text-secondary)]">
            Enterキーと矢印キーで移動できます。Escキーで編集中のセルを元に戻せます。
          </p>
        </div>
      </div>

      {isNarrowViewport ? null : <div className="mt-4 overflow-x-auto pb-2">{grid}</div>}

      {isNarrowViewport ? (
        <div className="mt-4 grid gap-3">
          {players.map((player, index) => (
            <article
              key={player.memberId}
              className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
            >
              <button
                className="flex w-full items-center justify-between text-left"
                type="button"
                onClick={() =>
                  setExpandedMobilePlayer((current) => (current === index ? -1 : index))
                }
              >
                <span className="font-semibold text-[var(--color-text-primary)]">
                  {memberDisplayName(player.memberId)}
                </span>
                <span className="text-xs text-[var(--color-text-secondary)]">
                  {expandedMobilePlayer === index ? "閉じる" : "詳細"}
                </span>
              </button>
              {expandedMobilePlayer === index ? (
                <div className="mt-3 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <label className="grid gap-1 text-xs text-[var(--color-text-secondary)]">
                      プレー順
                      <select
                        className={selectShortClass}
                        value={Number.isFinite(player.playOrder) ? String(player.playOrder) : ""}
                        onChange={(event) =>
                          onPlayOrderChange(index, Number.parseInt(event.target.value, 10))
                        }
                      >
                        <option value="">-</option>
                        {[1, 2, 3, 4].map((order) => (
                          <option key={order} value={order}>
                            {order}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label
                      className="grid gap-1 text-xs text-[var(--color-text-secondary)]"
                      htmlFor={`mobile-${index}-rank`}
                    >
                      順位
                      <ScoreGridNumericEditor
                        allowSign={false}
                        ariaLabel={`${memberDisplayName(player.memberId)} rank`}
                        baseClassName={textNumericShortClass}
                        cellId={`mobile-${index}-rank`}
                        commitKind="player"
                        field="rank"
                        row={index}
                        value={player.rank}
                        onPlayerCommit={handlePlayerNumericCommit}
                      />
                    </label>
                  </div>
                  <label
                    className="grid gap-1 text-xs text-[var(--color-text-secondary)]"
                    htmlFor={`mobile-${index}-totalAssetsManYen`}
                  >
                    総資産
                    <ScoreGridNumericEditor
                      allowSign
                      ariaLabel={`${memberDisplayName(player.memberId)} totalAssetsManYen`}
                      baseClassName={textNumericClass}
                      cellId={`mobile-${index}-totalAssetsManYen`}
                      commitKind="player"
                      field="totalAssetsManYen"
                      focusImageKind="total_assets"
                      row={index}
                      value={player.totalAssetsManYen}
                      onPlayerCommit={handlePlayerNumericCommit}
                      onPreferImageKindChange={onPreferImageKindChange}
                    />
                  </label>
                  <label
                    className="grid gap-1 text-xs text-[var(--color-text-secondary)]"
                    htmlFor={`mobile-${index}-revenueManYen`}
                  >
                    収益
                    <ScoreGridNumericEditor
                      allowSign
                      ariaLabel={`${memberDisplayName(player.memberId)} revenueManYen`}
                      baseClassName={textNumericClass}
                      cellId={`mobile-${index}-revenueManYen`}
                      commitKind="player"
                      field="revenueManYen"
                      focusImageKind="revenue"
                      row={index}
                      value={player.revenueManYen}
                      onPlayerCommit={handlePlayerNumericCommit}
                      onPreferImageKindChange={onPreferImageKindChange}
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {incidentColumns.map(([incidentKey, incidentLabel]) => (
                      <label
                        key={incidentKey}
                        className="grid gap-1 text-xs text-[var(--color-text-secondary)]"
                        htmlFor={`mobile-${index}-${incidentKey}`}
                      >
                        {incidentLabel}
                        <ScoreGridNumericEditor
                          allowSign={false}
                          ariaLabel={`${memberDisplayName(player.memberId)} ${incidentKey}`}
                          baseClassName={textNumericShortClass}
                          cellId={`mobile-${index}-${incidentKey}`}
                          commitKind="incident"
                          focusImageKind="incident_log"
                          incidentKey={incidentKey}
                          row={index}
                          value={player.incidents[incidentKey]}
                          onIncidentCommit={handleIncidentNumericCommit}
                          onPreferImageKindChange={onPreferImageKindChange}
                        />
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
