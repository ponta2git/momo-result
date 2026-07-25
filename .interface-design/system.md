# momo-result Interface Design System

## Direction and feel

- Design for people who need to find a registered match quickly, understand whether its data is confirmed, and continue to the next required action.
- Treat the product as a calm, compact match ledger rather than a generic dashboard.
- Ground decisions in the product vocabulary: held event, match number, OCR, confirmation state, result, rank, and export.
- Keep the hierarchy quiet. Structure, labels, alignment, and state should carry meaning before explanatory copy is added.
- The signature pattern is a confirmation overview connected directly to the next action for each match.

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

### Motion

- Motion should communicate state continuity, not decorate the interface.
- Use the existing fast/base motion tokens and decelerating easing.
- Prefer color, opacity, and transform transitions; avoid layout-shifting animation.
- Respect `prefers-reduced-motion` for every non-essential transition.
