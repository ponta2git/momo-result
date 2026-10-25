# design-sync notes (momo-result web)

## Setup

- Not a published library: `apps/web` is the app. `.design-sync/entry.ts` is the curated public surface (shared/ui only, app-agnostic). Add new shared/ui components there.
- `cfg.buildCmd` (`pnpm build && node .design-sync/build-pkg.mjs`) stages `.design-sync/.cache/pkg/` as a fake package: the vite-built Tailwind CSS (`app.css`) + tsc-emitted `.d.ts` (with `@/` rewritten to relative paths, since ts-morph has no tsconfig paths). Run it before the converter; `cfg.entry` points at the staged `index.ts`.
- Converter command (from `apps/web`): `node .ds-sync/package-build.mjs --config .design-sync/config.json --node-modules ./node_modules --out ./ds-bundle`.
- Component CSS is the app's compiled Tailwind v4 output: only utilities used somewhere in `src/` exist. Arbitrary values like `bg-[var(--color-surface-subtle)]` are fine only if the app already uses them.
- Provider chain (cfg.provider): TooltipProvider > AppMotionProvider (motion LazyMotion strict, required by `m.*` components) > MemoryRouter (links use react-router). `MemoryRouter` is re-exported from entry.ts and excluded from cards.
- Fonts: system font stacks only (no webfonts by design). `Cascadia Mono`/`Roboto Mono` are fallbacks in `--font-momo-data`; suppressed via `runtimeFontPrefixes`.

## Authoring previews

- Typecheck previews before building: `node_modules/.bin/tsc --noEmit -p .design-sync/tsconfig.previews.json` (maps `momo-result-ui` to entry.ts). The converter does NOT typecheck - e.g. StatusBadge takes `label`, not children, and silently rendered empty.
- Content: Japanese UI, domain is 桃鉄 (Momotaro Dentetsu) match results - players (ももたろう/きんたろう/うらしま/かぐや), 総資産/収益 in 万円, 開催, 試合, 目的地.
- Overlays (Dialog, AlertDialog, DialogFooter, ToastHost) use `cardMode: single`; DataTable uses `cardMode: column`. Changing an override's viewport needs a full `package-build.mjs` (`preview-rebuild.mjs` refuses with `[CONFIG_STALE]`).
- Only Tailwind utilities already used in `src/` exist in the compiled CSS; others silently no-op. Grep `.design-sync/.cache/pkg/app.css` (arbitrary values are escaped, e.g. `grep -F 'bg-\[var\(--color-surface\)\]'`) or use inline `style`. Seen missing: `w-56 w-80 w-96 pt-2 pt-3 pt-10 max-w-xs border-collapse bg-[var(--color-canvas)]`.
- Page-layout previews: wrap in `<div className="p-4" style={{ background: "var(--color-canvas)" }}>` so white surfaces are visible.
- Static-only states: Tooltip/TooltipProvider and IconButton/IconLink `tooltip` need hover (trigger-only cards); Select popups and ChoicePickerDialogField's dialog need interaction (closed state shown).
- ToastHost renders statically when the preview seeds toasts via `showToast({ ..., timeout: 0 })` in a `useEffect` with stable ids.
- Component quirks: ActionLink is unstyled (compose `className={buttonClassName(...)}`, pass `disabled` to the recipe too); PendingActionContent is a button's inner label; Tabs parts throw outside TabsRoot and reject `className`; Field needs `htmlFor` + unique control `id` per cell; IconButton/IconLink `sm` and `md` are both 44px; AdjacentNavigation destination without `href` = non-link end; StaleShield pill overlays the top (pad children); TableScrollArea needs a native `<table>` wide enough to overflow; don't name an export `Error`.

## Known render warns

- `[GRID_OVERFLOW]` ProgressBar (escape): the fill is a full-width element scaled via transform inside an overflow-hidden track; visually contained. Benign.
- `[RENDER_THIN]` Dialog, AlertDialog, DialogFooter: content is portaled/fixed so the measured root is 0px; screenshots show the open dialog. Benign.
- `[TOKENS_MISSING]` --anchor-width/--available-width/--available-height (Base UI sets at runtime), --recent-rank-scroll-thumb-width (set inline by a feature) - expected.

## Re-sync risks

- `.design-sync/entry.ts` is a hand-curated list: new shared/ui components are not synced until added there (and to a preview).
- `app.css` is the app's compiled Tailwind output: class availability (and the conventions header's class list) shifts whenever src/ stops or starts using a utility. Re-run the conventions validation after big UI refactors.
- `build-pkg.mjs` rewrites `@/` specifiers in emitted .d.ts; a new tsconfig path alias would need the same treatment.
- Toolchain assumptions: node 24 (mise), pnpm 10, playwright 1.63.0 in `.ds-sync` (matches cached chromium headless shell 1243).
- Previews for Dialog/Toast/Tooltip depend on Base UI internals rendering `open`/seeded state statically; a Base UI upgrade may change that.
