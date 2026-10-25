# momo-result UI — conventions for building with this library

Japanese-language results app for 桃鉄 (Momotaro Dentetsu) leagues: 開催, 試合, プレイヤー, 総資産/収益 (万円), 順位. Write UI copy in Japanese.

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

- `styles.css` is the app's **compiled** Tailwind v4 output. Only utilities the app already uses exist; an unused class (e.g. `w-56`, `pt-2`, `max-w-xs`, `bg-[var(--color-canvas)]`) silently does nothing. Prefer the library components; for layout glue use common utilities (`grid`, `flex`, `flex-wrap`, `items-center`, `justify-between`, `gap-2/3/4/6`, `p-3/4`, `mt-4`, `space-y-4`, `grid-cols-2/3`, `min-w-0`, `w-72`, `max-w-lg`, `rounded-md`), and use inline `style={{ ... }}` with `var(--color-*)` for anything else.
- Colors are semantic CSS variables — never raw hex. Text: `--color-text-primary`, `--color-text-body`, `--color-text-secondary`, `--color-text-muted`, `--color-text-inverse`. Surfaces: `--color-canvas` (page background), `--color-surface`, `--color-surface-subtle`, `--color-border`, `--color-border-strong`. Intent: `--color-action`, `--color-danger`, `--color-success`, `--color-warning`, `--color-status-info`, `--color-review`. Ranks: `--color-rank-1..4` (+ `-foreground`); players: `--color-member-sequence-1..4`; charts: `--color-series-1..6`.
- These arbitrary classes exist: `text-[var(--color-text-primary|body|secondary|muted)]`, `bg-[var(--color-surface)]`, `bg-[var(--color-surface-subtle)]`, `border-[var(--color-border)]`, `text-[var(--color-danger)]`.
- Typography uses role recipes, not ad-hoc sizes: `contentText.primary | compactPrimary | heading | body | supporting` and `fieldText.label | description | error` (exported strings of classes, combine with `cn`). Weights: `font-plain`, `font-structure`, `font-emphasis`. Fonts are system stacks (no webfonts).
- Button-looking links/spans: `buttonClassName({ variant, size, disabled })` / `iconActionClassName(...)`.

## Component rules that bite

- `StatusBadge` takes `label` (not children). `Button` variants: `primary | secondary | quiet | danger | dangerQuiet`; `pending` + `pendingLabel` for in-flight actions.
- `Field` needs `htmlFor` matching the control's `id`; `TextField`/`SelectField` bundle label + control.
- `TabsRoot` > `TabsList` > `TabsTab`, plus `TabsPanel`; parts throw outside `TabsRoot` and take no `className`.
- `DataTable` is generic: `columns` with `key`, `header`, `renderCell(row)`, `getRowKey`, `caption`.
- `Notice` tones `info | success | warning | danger`; `EmptyState` for empty lists; `ResourcePageState` for not-found/load-error pages; `Skeleton`/`PageLoadingFallback` for loading.
- Page layout: `PageFrame` > `PageHeader` (title, description, actions) > `PageContentSurface` on a `--color-canvas` background.

## Where the truth lives

Read `styles.css` (tokens under `:root`, component classes like `.momo-surface-*`) and each component's `.d.ts` / `.prompt.md` before styling.

## Example

```jsx
const { PageFrame, PageHeader, PageContentSurface, Button, DataTable, StatusBadge } = window.MomoUI;
<div style={{ background: "var(--color-canvas)" }} className="p-4">
  <PageFrame>
    <PageHeader
      title="試合結果"
      description="開催ごとの最終順位を確認できます。"
      actions={<Button>試合を登録</Button>}
    />
    <PageContentSurface>
      <DataTable
        caption={{ content: "第12回 最終順位", visibility: "visible" }}
        getRowKey={(r) => r.player}
        rows={[{ rank: 1, player: "ももたろう", assets: 128400 }]}
        columns={[
          { key: "rank", header: "順位", align: "right", renderCell: (r) => `${r.rank}位` },
          { key: "player", header: "プレイヤー", rowHeader: true, renderCell: (r) => r.player },
          {
            key: "assets",
            header: "総資産",
            align: "right",
            tabular: true,
            renderCell: (r) => `${r.assets.toLocaleString("ja-JP")}万円`,
          },
          {
            key: "state",
            header: "状態",
            renderCell: () => <StatusBadge label="確定" tone="success" />,
          },
        ]}
      />
    </PageContentSurface>
  </PageFrame>
</div>;
```
