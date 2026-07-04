import type {
  MatchFormValues,
  OriginalPlayerSnapshot,
} from "@/features/matches/workspace/matchFormTypes";
import {
  incidentScoreGridColumns,
  keyToPath,
  memberSelectClass,
  playerFieldLabels,
  playerSlotKey,
  scoreGridColumns,
  selectShortClass,
  textNumericClass,
  textNumericShortClass,
} from "@/features/matches/workspace/scoreGrid/ScoreGridColumns";
import type { GridColumn } from "@/features/matches/workspace/scoreGrid/ScoreGridColumns";
import { ScoreGridNumericEditor } from "@/features/matches/workspace/scoreGrid/ScoreGridNumericEditor";
import type {
  ScoreGridActions,
  ScoreGridCellRegistry,
  ScoreGridData,
  ScoreGridKeyboardHandler,
  ScoreGridNumericHandlers,
} from "@/features/matches/workspace/scoreGrid/ScoreGridTypes";
import { fixedMembers, memberDisplayName } from "@/shared/domain/members";

type ScoreGridDesktopTableProps = ScoreGridData &
  ScoreGridCellRegistry &
  ScoreGridNumericHandlers & {
    handleKeyboard: ScoreGridKeyboardHandler;
    onPlayerChange: ScoreGridActions["onPlayerChange"];
    onPlayOrderChange: ScoreGridActions["onPlayOrderChange"];
    onPreferImageKindChange?: ScoreGridActions["onPreferImageKindChange"] | undefined;
    originalByPlayOrder: Map<number, OriginalPlayerSnapshot>;
  };

export function ScoreGridDesktopTable({
  errorPathSet,
  getCellId,
  handleIncidentNumericCommit,
  handleKeyboard,
  handlePlayerNumericCommit,
  lastSyncedPlayerIndex,
  onPlayerChange,
  onPlayOrderChange,
  onPreferImageKindChange,
  originalByPlayOrder,
  originalPlayers,
  players,
  registerCellRef,
}: ScoreGridDesktopTableProps) {
  return (
    <table className="min-w-[64rem] table-fixed border-separate border-spacing-y-2 text-left text-sm">
      <colgroup>
        {scoreGridColumns.map((column) => (
          <col key={column.column} className={column.widthClass} />
        ))}
      </colgroup>
      <thead className="text-xs text-[var(--color-text-secondary)]">
        <tr>
          {scoreGridColumns.map((column) => (
            <th
              key={column.column}
              className={
                column.kind === "member"
                  ? "sticky left-0 z-[var(--z-dropdown)] bg-[var(--color-surface)] px-2 py-2"
                  : "px-2 py-2"
              }
            >
              {column.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {players.map((player, rowIndex) => {
          const originalRow = originalPlayers?.[rowIndex];
          const originalByOrder = originalByPlayOrder.get(player.playOrder);
          return (
            <tr key={playerSlotKey(rowIndex)} className="bg-[var(--color-surface-subtle)]">
              <td className="sticky left-0 z-[var(--z-sticky)] rounded-l-[var(--radius-md)] bg-[var(--color-surface-subtle)] px-2 py-3 align-top">
                <select
                  ref={(node) => registerCellRef(getCellId(rowIndex, 0), node)}
                  aria-label={`${memberDisplayName(player.memberId)} メンバー`}
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
                <select
                  ref={(node) => registerCellRef(getCellId(rowIndex, 1), node)}
                  aria-label={`${memberDisplayName(player.memberId)} プレー順`}
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
              </td>

              <PlayerNumericDesktopCell
                col={2}
                error={errorPathSet.has(keyToPath(rowIndex, "rank"))}
                field="rank"
                originalValue={originalRow?.rank}
                player={player}
                rowIndex={rowIndex}
                getCellId={getCellId}
                handleKeyboard={handleKeyboard}
                handlePlayerNumericCommit={handlePlayerNumericCommit}
                registerCellRef={registerCellRef}
              />
              <PlayerNumericDesktopCell
                allowSign
                col={3}
                error={errorPathSet.has(keyToPath(rowIndex, "totalAssetsManYen"))}
                field="totalAssetsManYen"
                focusImageKind="total_assets"
                originalValue={originalRow?.totalAssetsManYen}
                player={player}
                rowIndex={rowIndex}
                getCellId={getCellId}
                handleKeyboard={handleKeyboard}
                handlePlayerNumericCommit={handlePlayerNumericCommit}
                onPreferImageKindChange={onPreferImageKindChange}
                registerCellRef={registerCellRef}
              />
              <PlayerNumericDesktopCell
                allowSign
                col={4}
                error={errorPathSet.has(keyToPath(rowIndex, "revenueManYen"))}
                field="revenueManYen"
                focusImageKind="revenue"
                originalValue={originalRow?.revenueManYen}
                player={player}
                rowIndex={rowIndex}
                getCellId={getCellId}
                handleKeyboard={handleKeyboard}
                handlePlayerNumericCommit={handlePlayerNumericCommit}
                onPreferImageKindChange={onPreferImageKindChange}
                registerCellRef={registerCellRef}
              />

              {incidentScoreGridColumns.map((column, incidentIndex) => {
                const col = incidentIndex + 5;
                const { incidentKey } = column;
                const cellId = getCellId(rowIndex, col);
                return (
                  <td
                    key={incidentKey}
                    className="px-2 py-3 align-top last:rounded-r-[var(--radius-md)]"
                  >
                    <ScoreGridNumericEditor
                      allowSign={false}
                      ariaLabel={`${memberDisplayName(player.memberId)} ${column.header}`}
                      baseClassName={textNumericShortClass}
                      cellId={cellId}
                      col={col}
                      commitKind="incident"
                      error={errorPathSet.has(
                        keyToPath(rowIndex, `incident.${incidentKey}` as GridColumn),
                      )}
                      focusImageKind="incident_log"
                      incidentKey={incidentKey}
                      originalValue={originalByOrder?.incidents[column.header]}
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
}

type PlayerNumericDesktopCellProps = ScoreGridCellRegistry &
  Pick<ScoreGridNumericHandlers, "handlePlayerNumericCommit"> & {
    allowSign?: boolean;
    col: number;
    error: boolean;
    field: keyof typeof playerFieldLabels;
    focusImageKind?: "incident_log" | "revenue" | "total_assets";
    handleKeyboard: ScoreGridKeyboardHandler;
    onPreferImageKindChange?: ScoreGridActions["onPreferImageKindChange"] | undefined;
    originalValue: number | undefined;
    player: MatchFormValues["players"][number];
    rowIndex: number;
  };

function PlayerNumericDesktopCell({
  allowSign = false,
  col,
  error,
  field,
  focusImageKind,
  getCellId,
  handleKeyboard,
  handlePlayerNumericCommit,
  onPreferImageKindChange,
  originalValue,
  player,
  registerCellRef,
  rowIndex,
}: PlayerNumericDesktopCellProps) {
  const baseClassName = field === "rank" ? textNumericShortClass : textNumericClass;
  return (
    <td className="px-2 py-3 align-top">
      <ScoreGridNumericEditor
        allowSign={allowSign}
        ariaLabel={`${memberDisplayName(player.memberId)} ${playerFieldLabels[field]}`}
        baseClassName={baseClassName}
        cellId={getCellId(rowIndex, col)}
        col={col}
        commitKind="player"
        error={error}
        field={field}
        focusImageKind={focusImageKind}
        originalValue={originalValue}
        registerCellRef={registerCellRef}
        row={rowIndex}
        showStateLabel
        value={player[field]}
        onKeyboard={handleKeyboard}
        onPlayerCommit={handlePlayerNumericCommit}
        onPreferImageKindChange={onPreferImageKindChange}
      />
    </td>
  );
}
