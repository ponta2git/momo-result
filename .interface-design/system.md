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

### Held event hub

- Treat the held-event list as a chronological ledger, not as a card dashboard. Lead each entry with the exact held date and time, then keep only confirmed and active-draft counts in one compact reading path. Reserve the next match number for event detail and record-start flows.
- Create a held event in a focused dialog and navigate directly to its detail after success. Keep creation separate from list scanning so form expansion never moves the ledger unexpectedly.
- Treat the event detail as the hub for one session: identity and counts, next-match actions, active drafts, deterministic player recap, match-number timeline, then export and management.
- Use the match-number timeline as the signature event visual. Mark it up as an ordered list, keep the number axis stable, and place result and scoped-comparison actions beside the corresponding match.
- Derive wins, average rank, and rank sequence only from saved results, and always retain sample-size context. Do not infer causes, confidence, or recommendations at event scope.
- Preserve `heldEventId` through manual entry, OCR capture, match search, export, match detail, and return navigation. Use the server-provided next match number rather than deriving it from counts in the browser.
- Offer event deletion only when both confirmed matches and active drafts are absent, and keep the destructive confirmation explicit.
- Use final-shape skeletons and distinct empty states for a new event, draft-only event, result-only event, and mixed event. Do not collapse these states into a generic “no data” message.

### CSV/TSV export

- Treat export as one short decision flow in stable visual and DOM order: scope, scoped target when required, file format, generated summary, then the primary download action.
- Use one concise page title and one bordered task surface. Do not repeat the same conditions in a second ticket, overview card, decorative illustration, or interaction-obvious explanatory paragraph.
- State the selected target and format in a sentence immediately before the action. Name the action with both its scope and format, such as “この試合をTSVでダウンロード”.
- Keep invariant file facts in one quiet line: confirmed matches only, one player per row, and monetary values in ten-thousand-yen units.
- Use a native select for short master lists. For long held-event and match lists, use a focused selection dialog with bounded scrolling and server-backed pagination; preserve the current selection while paging and resolve page-external deep links to human-readable labels.
- Keep loading, refreshing, empty, invalid-URL, download progress, success, timeout, and failure feedback beside the control or action that owns it. Provide a local retry or reset action and never duplicate the same outcome in both a toast and inline notice.
- Animate only selection continuity and the entry of newly relevant status feedback. Keep geometry stable, avoid looping progress decoration, and honor reduced motion.

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

### OCR result review

- Keep the task sequence stable: destination and match context, global OCR notices, four-player review grid with source reference, then the primary confirmation action.
- Collapse completed match context into one scan-friendly summary. Reopen it explicitly for changes, and force it open whenever required fields are invalid.
- Treat the guided OCR review rail as the signature interaction. Show unresolved progress, the active field, concise evidence, source kind, and confidence; provide previous, next, and explicit acknowledgement actions.
- Attach OCR evidence to the semantic field and player identity before any result sorting. A warning must follow its source value rather than its original display row.
- Use one deterministic cell-state priority: invalid, OCR review, manually changed, reviewed, then synced. Reserve a stable status line so state changes do not alter row height.
- In automatic source-image mode, the image follows the focused field. Selecting an image tab switches to fixed mode; only an explicit “自動追従” action resumes following.
- Use a dense ledger on wide viewports and one accordion card per player on narrow viewports. Mobile review navigation expands the target player and focuses the exact field without horizontal page overflow.
- Keep confirmation warnings as a soft gate: summarize changes and unresolved OCR items beside a rank-sorted four-player ledger, but leave the final action available.
- Persist unfinished values and OCR acknowledgements in tab-scoped storage. Offer recovery instead of silently overwriting initialized data, and confirm before discarding dirty work during navigation or unload.
- Animate only continuity-bearing changes such as mobile-card disclosure, dialog entry, and segmented-control selection. Keep cell feedback to quiet color transitions and respect reduced motion.

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
