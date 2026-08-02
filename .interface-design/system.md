# momo-result Interface Design System

## Direction and feel

- Design for people who need to find a registered match quickly, understand whether its data is confirmed, and continue to the next required action.
- Treat the product as a calm, compact match ledger rather than a generic dashboard.
- Ground decisions in the product vocabulary: held event, match number, OCR, confirmation state, result, rank, and export.
- Keep the hierarchy quiet. Structure, labels, alignment, and state should carry meaning before explanatory copy is added.
- The signature patterns are a confirmation overview connected directly to the next action, and one four-player result ledger shared by match detail and selected-match comparison context.

## Foundations

### Palette and surfaces

- Use the existing semantic CSS tokens. Do not introduce one-off colors in feature components.
- Reserve the action color for selection, focus, and actionable emphasis.
- Use `--color-surface`, `--color-surface-subtle`, and `--color-surface-selected` to express hierarchy without decorative color.
- Use primary, secondary, and muted text tokens consistently for content, metadata, and disabled states.

### Depth

- Use a borders-first depth strategy with quiet surface-color shifts.
- Use the existing border progression for ordinary separation and stronger table/header boundaries.
- Avoid decorative shadows, gradients, and large contrast jumps in dense operational screens.

### Typography

- Use the existing application typeface and established text scale.
- Combine weight and text color to create hierarchy; do not add headings only to create visual separation.
- Use tabular numerals for dates, counts, rankings, and other aligned numeric data.

### Spacing

- Use a 4px base unit.
- Prefer 8px for icon/text and tightly related controls, 12px for compact component padding, and 16px for section padding and ordinary group separation.
- Keep control padding symmetrical unless content creates a clear reason for asymmetry.
- Preserve the page-shell spacing already established by shared layout components.

## Reusable component patterns

### Page and section hierarchy

- Keep one concise page title for location and document structure.
- Omit visible section headings and explanatory copy when the controls or content already make the section's purpose clear.
- Preserve semantic structure with `section`, `aria-label`, field labels, and accessible control names when visible headings are omitted.

### Status navigation

- Show confirmation status as a small set of direct filters rather than a separate unfinished-work summary.
- Disable the selected status control so selecting it again cannot trigger flicker or duplicate loading.
- Keep unfinished sub-status controls visually subordinate to the primary confirmation split.

### Filter accordion

- Use one reset action for the complete display state. Do not place similarly named full-reset and partial-clear actions together.
- Place the reset action in the trailing toolbar area and label its scope clearly.
- Summarize up to three active detail conditions as compact badges inside the accordion header.
- Visually truncate long badge text while retaining the full text in the DOM and a discoverable full label.
- Place a chevron at the trailing edge and rotate only the chevron to communicate open state.
- Do not apply press/scale/translate animation to an accordion header. A quiet color transition and chevron rotation are sufficient.

### Match result tables

- Size columns from expected content length, then allow the descriptive ranking column to absorb remaining width.
- Vertically center heterogeneous row content when compact icon actions sit beside multi-line summaries.
- Keep match identity as text; place result navigation and export in adjacent, explicitly labeled action columns.
- Use 44px icon-link targets, descriptive `aria-label` values containing match context, and tooltips for compact actions.
- Use a result-record icon for result navigation and a download icon for export. Decorative icons remain `aria-hidden`.
- Represent unavailable icon links with `aria-disabled="true"` and a non-interactive element.

### Match result detail

- Lead with a concise match title and one inline identity band for date, game title, season, and map. Do not add a generic overview paragraph.
- Use one four-player result ledger as the primary surface. Align rank, player name, and total assets for immediate scanning; keep revenue, revenue rank, revenue-to-assets rate, and cumulative-average change subordinate in each row.
- Constrain the primary result-ledger surface to a comfortable reading width on wide viewports and center it. The detailed sortable result table may remain wide when its column density requires it.
- Express cumulative-average changes with before/after values plus “改善”, “後退”, “維持”, or “初戦”. Never make a signed decimal carry the meaning by itself.
- Treat match features as compact metadata badges beside the identity context, not as a separate summary-card collection.
- Keep the full sortable incident table after the result ledger. Put owner, played/confirmed timestamps, and destructive actions in a final record-information surface.
- Fetch same-game, same-season, same-map comparison context without blocking the primary match result. Loading, stale placeholder, failure, and a missing target match must not replace the result ledger.

### Motion

- Motion should communicate state continuity, not decorate the interface.
- Use the existing fast/base motion tokens and decelerating easing.
- Prefer color, opacity, and transform transitions; avoid layout-shifting animation.
- Respect `prefers-reduced-motion` for every non-essential transition.

### OCR capture

- Keep the task order stable in both visual layout and DOM order: record destination, camera, classification trays, then submission.
- Make the three classification trays the signature workflow. Always show the active capture target, advance to the next empty tray after a successful capture, and let users select a tray explicitly before replacing its image.
- Treat the camera as the primary input. Keep file selection behind a quiet fallback disclosure, then promote it only when camera startup fails.
- Use concise local state labels such as “画像待ち”, “配置済み”, and “次の撮影先”. Do not repeat the same classification explanation in headings, cards, and help copy.
- Keep every tray preview frame at 16:9 in empty, selected, and working states. Place source metadata inside the frame so image arrival never changes the tray geometry.
- Snapshot the setup and selected images when the start-confirmation dialog opens. During upload and OCR-job registration, keep the dialog non-dismissible and block both in-app navigation and browser unload.
- Navigate automatically only after every selected image is handed off. If only part of the handoff succeeds, keep the result dialog visible and require an explicit move to the match list to avoid duplicate submission.
- Animate only status or preview replacement with the existing short opacity treatment. Do not stagger tray entry or animate tray layout.

### Series comparison

- Treat series comparison as a path from next-match hypothesis to evidence to an individual match, not as a KPI dashboard.
- Keep one page title, followed by a compact scope bar ordered as game title, season, then map.
- Separate the top-level purpose into “次戦に備える” and “分析する”. Within analysis, use “今の差”, “勝因候補”, “推移”, and “条件別” as actual tabs.
- Do not repeat a universal summary strip above every purpose. Put match count in the scope bar and keep each result in its owning analysis section.
- In the next-match view, place one compact, content-led common-topic accordion before the player columns, then show one equal-height primary hypothesis per player. Put secondary hypotheses in player-level disclosures, but open card evidence and classification/reliability help in dialogs so they do not change the comparison geometry.
- Accordion headers must preview the actual topic or active conditions. Do not spend the header on counts or interaction-obvious phrases such as “まとめて確認”.
- Keep the page gutter stable when disclosures change the document height, so opening “ほかの仮説” does not move the comparison columns horizontally.
- Style in-page section navigation as a quiet table of contents, not as tags or filter chips.
- Chart legends must wrap outside the plot. Distinguish player series by color plus line or point treatment, and constrain any horizontal scrolling to the chart or table itself.
- On mobile drilldowns, keep one vertical scroll region for the dialog body so controls and evidence tables remain reachable below charts. Constrain chart overflow to the horizontal axis so vertical swipes continue through the dialog.
- Keep every axis name and tick label inside its SVG/card boundary. Center quadrant plot areas with balanced left/right padding, reserving dedicated space for a vertical y-axis title.
- Explanatory copy describes meaning, direction, comparison conditions, or data limitations. Do not narrate visible controls, disclosure behavior, or layout.
- Preserve table-specific vocabulary when it helps recognition: use “桃鉄型（物件重視）” and “遊戯王型（カード重視）” for the earning-mix axis, while avoiding an unrelated second “〜型” label in the same card.
- Do not animate every chart mark. If continuity benefits from motion, reveal the whole figure once on viewport entry within 200ms and disable it for reduced motion.
- A match result links to the corresponding comparison scope, and comparison evidence links back to the source match while preserving URL state.
- When a match is selected, reuse the result ledger above the comparison purpose tabs and mark the same match in supported charts with a labeled guide or outlined points. Also mark exact rows or cells in value lists and tables when the selected match maps to them deterministically; never infer a marker when match-level evidence is unavailable. Keep the focus through analysis-tab changes; clearing it removes the panel and every marker.
- Animate only the selected-match panel and focus markers with the existing panel-entry treatment. Do not stagger player rows or animate every chart point.
