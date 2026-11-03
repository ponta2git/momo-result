# momo-result UI — conventions for building with this library

Japanese-language results app for four fixed friends who play 桃鉄 (Momotaro Dentetsu): 開催 ⊃ 試合 ⊃ 4人の結果, 総資産/収益 (万円), 順位. Write UI copy in Japanese with the app's vocabulary: プレーヤー (not プレイヤー), 開催, 試合番号, 下書き, 確定, 出力.

The full rules live in `docs/ui-rule.md` of the repository; this page is the digest that designs must not contradict.

## Design principles (digest of `docs/ui-rule.md`)

- **Two zones.** Recording work (OCR import, draft review, manual entry, settings, export) stays quiet: calm, precise, few steps, no decoration. Moments where the four receive a result (right after confirming, the end of a 開催, achievements, look-backs) may celebrate with layout, a celebratory color/surface, a large result number (24/30px), copy that praises the winner, and one finite motion. One moment per screen, results and actions never wait for it, and it must also read when static.
- **Precision first.** Show only values the data supports. Unknown, not-yet-read, waiting-for-aggregation and a real 0 are different states. Never single out the last place, a decline, or a miss; praise facts and actions, not ability.
- **One anchor per screen.** The anchor is the main result, the main action, or the current state — not a decorated heading. Bold (`font-emphasis`) is only for the answer, a celebration, or the one-line problem that blocks work. Labels, headings, buttons and statuses stay regular.
- **One white surface per task.** Do not split a surface into tinted section cards. Group with alignment and spacing first; tint only selection, status, insets, compact badges and celebration surfaces. Shadows only for floating UI.
- **Color meaning.** `--color-action` fills only the primary action and marks selection/focus. Destructive triggers use `dangerQuiet`; a filled `danger` button appears only as the confirm button inside the confirmation dialog. Rank colors: only 1位 has the celebratory gold; 2–4位 stay calm and never read as an error. Member colors and play-order colors share the same four hues but are different meanings; never reuse them for other series, states or decoration.
- **Fixed members.** Always いーゆー → ぽんた → あかねまみ → おーたか, with `--color-member-sequence-1..4` in that order. A single match's result ledger is ordered by rank (1位 first); shared ledgers, tables and chart legends use the fixed order. When a row also shows play order, only the play-order mark carries the color and the name stays neutral.

## Screen types

| Type                       | Screens                    | Anchor                                              | Visible page header | Primary action                                              | Width                                           |
| -------------------------- | -------------------------- | --------------------------------------------------- | ------------------- | ----------------------------------------------------------- | ----------------------------------------------- |
| List                       | 試合一覧, 開催一覧, 下書き | the data surface                                    | none                | top of the data surface                                     | `default`                                       |
| Detail                     | 試合詳細                   | identity and result                                 | `PageHeader`        | edit/export near the header; delete stays quiet in 記録情報 | `default`                                       |
| Held-event hub             | 開催詳細                   | the next match to record and this 開催's conclusion | `PageHeader`        | 「第N試合を記録」                                           | `default`                                       |
| Review workspace           | OCR 確認, 手入力           | the current item and its next fix or confirm        | none                | final action panel at the end                               | `workspace` with a source image, else `default` |
| Look-back                  | 戦績比較, 実績             | the compared results                                | none                | conditions near what they scope                             | `analysis`                                      |
| Import / export / settings | OCR 取り込み, 出力, 設定   | the task and whether it can run                     | none                | near what it acts on                                        | `default` (`readable` for short forms)          |

Pages without a header give the main `PageContentSurface` an `aria-label` and keep section headings inside it.

## Wrap every screen

Links (`ActionLink`, `LinkButton`, `IconLink`, `AdjacentNavigation`) need a router, motion components need `AppMotionProvider`, and tooltips share `TooltipProvider`. Render `ToastHost` once if you call `showToast`.

```jsx
const { TooltipProvider, AppMotionProvider, MemoryRouter, ToastHost } = window.MomoUI;
<TooltipProvider>
  <AppMotionProvider>
    <MemoryRouter>
      <App />
      <ToastHost />
    </MemoryRouter>
  </AppMotionProvider>
</TooltipProvider>;
```

## Styling idiom: Tailwind utilities + semantic CSS variables

- `styles.css` is the app's **compiled** Tailwind v4 output. Only utilities the app already uses exist; an unused class (e.g. `w-80`, `pt-2`, `max-w-xs`, `bg-[var(--color-canvas)]`) silently does nothing. Prefer the library components; for layout glue use common utilities (`grid`, `flex`, `flex-wrap`, `items-center`, `justify-between`, `gap-2/3/4/6`, `p-3/4`, `mt-4`, `space-y-4`, `grid-cols-2/3`, `min-w-0`, `w-72`, `max-w-lg`, `rounded-md`), and use inline `style={{ ... }}` with `var(--color-*)` for anything else.
- Colors are semantic CSS variables — never raw hex. Text: `--color-text-primary`, `--color-text-body`, `--color-text-secondary`, `--color-text-muted`, `--color-text-inverse`. Surfaces: `--color-canvas` (page background), `--color-surface`, `--color-surface-subtle`, `--color-border`, `--color-border-strong`. Intent: `--color-action`, `--color-danger`, `--color-success`, `--color-warning`, `--color-status-info`, `--color-review`. Ranks: `--color-rank-1..4` (+ `-foreground`); players: `--color-member-sequence-1..4`; play order: `--color-play-order-1..4`; charts: `--color-series-1..6`.
- These arbitrary classes exist: `text-[var(--color-text-primary|body|secondary|muted)]`, `bg-[var(--color-surface)]`, `bg-[var(--color-surface-subtle)]`, `border-[var(--color-border)]`, `text-[var(--color-danger)]`.
- Typography uses role recipes, not ad-hoc sizes: `contentText.primary | compactPrimary | heading | body | supporting` and `fieldText.label | description | error` (exported strings of classes, combine with `cn`). Weights: `font-plain`, `font-structure`, `font-emphasis`. Sizes come from 12/14/16/18/20/24/30px. Fonts are system stacks (no webfonts).
- Button-looking links/spans: `buttonClassName({ variant, size, disabled })` / `iconActionClassName(...)`.

## Component rules that bite

- `StatusBadge` takes `label` (not children); tones `neutral | progress | attention | success | warning | danger`. `Button` variants: `primary | secondary | quiet | danger | dangerQuiet`; `pending` + `pendingLabel` for in-flight actions.
- `Field` needs `htmlFor` matching the control's `id`; `TextField`/`SelectField` bundle label + control.
- `TabsRoot` > `TabsList` > `TabsTab`, plus `TabsPanel`; parts throw outside `TabsRoot` and take no `className`.
- `DataTable` is generic: `columns` with `key`, `header`, `renderCell(row)`, `getRowKey`, `caption`.
- `Notice` tones `info | success | warning | danger`; `EmptyState` for empty lists (one safe primary action); `ResourcePageState` for not-found/load-error pages; `Skeleton`/`PageLoadingFallback` for loading.
- Page layout: `PageFrame` (`width`: `readable | default | analysis | workspace`) > `PageContentSurface` on a `--color-canvas` background. Only the detail and held-event hub types add `PageHeader` before the surface.

## Where the truth lives

Read `styles.css` (tokens under `:root`, component classes like `.momo-surface-*`) and each component's `.d.ts` / `.prompt.md` before styling. Component-internal behavior (keys, scroll ownership, inner spacing) is documented on the component itself.

## Example: resource detail

```jsx
const { PageFrame, PageHeader, PageContentSurface, Button, DataTable } = window.MomoUI;
<div style={{ background: "var(--color-canvas)" }} className="p-4">
  <PageFrame width="default">
    <PageHeader
      title="第1試合の結果"
      actions={<Button variant="secondary">試合結果を編集</Button>}
    />
    <PageContentSurface>
      <DataTable
        caption={{ content: "順位と総資産", visibility: "visible" }}
        getRowKey={(r) => r.player}
        rows={[
          { rank: 1, player: "あかねまみ", assets: 52000 },
          { rank: 2, player: "ぽんた", assets: 31500 },
          { rank: 3, player: "おーたか", assets: 9800 },
          { rank: 4, player: "いーゆー", assets: 1200 },
        ]}
        columns={[
          { key: "rank", header: "順位", align: "right", renderCell: (r) => `${r.rank}位` },
          { key: "player", header: "プレーヤー", rowHeader: true, renderCell: (r) => r.player },
          {
            key: "assets",
            header: "総資産",
            align: "right",
            tabular: true,
            renderCell: (r) => `${r.assets.toLocaleString("ja-JP")}万円`,
          },
        ]}
      />
    </PageContentSurface>
  </PageFrame>
</div>;
```
