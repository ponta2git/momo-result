# momo-result interface design system

## Direction

The interface should feel like a post-game capture desk: a calm capture workbench used right after a Momotetsu match ends. The primary human is one of the fixed four players, likely reviewing screenshots after a long game session, trying to quickly capture three result screens, classify them correctly, and send them to OCR without wondering which hidden state the app is in.

It may often be used at night, so the palette should be easy on the eyes and low-glare. The atmosphere should come from Momotetsu's railway/sugoroku world and the OCR sample result screens, moderated into a practical tool UI.

The design should prioritize procedural clarity over decorative dashboard patterns. The core flow is:

1. Capture or add images in one place.
2. Arrange them into three classification trays.
3. Send the arranged trays to OCR and save drafts explicitly.

## Domain concepts

- Post-game result capture
- Capture board / video preview
- Result screen sequence
- Classification trays
- OCR draft saving
- Fixed four-player table
- Train/rail ordering as a metaphor for moving images into the right place
- Station signs, routes, dice, ranking screens, ledgers, and event logs from Momotetsu's UI world

## Color world

Use colors that feel native to Momotetsu result screens and official-site imagery, then calm them down for a focused tool interface. The UI may reference the official sites and local OCR sample images for color temperature, density, and rhythm, but should never copy or imitate copyrighted artwork, characters, logos, or layouts directly.

- Calm evening navy for the app canvas: dark enough for low glare, without making darkness the product identity.
- Capture-card black for preview and media surfaces.
- Blue-white monitor glow for quiet emphasis and image-related states.
- Warm station-sign yellow / rail gold for primary action and procedural guidance.
- Route-map blue and green as restrained supporting colors when classification needs them.
- Red-magenta for incident log / warning-adjacent emphasis, used sparingly.
- Off-white paper/card tones from result tables for readable foreground text.
- Muted ink lavender or slate-blue for secondary Japanese text on dark backgrounds.

Color should communicate classification, status, or action. Do not add extra accent colors for decoration.

## Signature pattern

The signature interaction is **Capture Deck -> Classification Trays -> OCR Command**.

This should appear in concrete UI elements:

- A single camera/capture zone, never one camera per image type.
- Three classification trays named by final OCR image type: total assets, revenue, incident log.
- Drag-and-drop between trays, with button alternatives for left/right movement.
- Explicit CTA: "OCRにかけて下書き保存".
- Copy that explains the tray position becomes the OCR image type hint.

## Rejected defaults and replacements

- Default: three independent upload/camera cards.
  Replacement: one capture deck feeding three classification trays.
- Default: raw internal status badges such as `empty` or `cancelled`.
  Replacement: user-facing Japanese labels such as `未配置`, `OCR待ち`, `下書き保存済み`, `要確認`.
- Default: an ambiguous "lock/fix this type" button.
  Replacement: moving the image into the correct tray is the type selection.
- Default: image selection immediately starts OCR.
  Replacement: image placement is local; OCR starts only from the explicit save CTA.
- Default: generic dashboard metric/card grid.
  Replacement: a procedural workbench with media preview, tray placement, and a clear next action.

## Depth strategy

Use dark-mode surface shifts and quiet borders, not dramatic shadows.

- Canvas: calm evening navy.
- Primary cards: slightly lifted navy surface with low-opacity white border.
- Media wells and controls: darker/inset blackened surfaces.
- Notices and warnings: tinted surfaces with restrained borders.
- Prefer surface shifts and borders over large shadows. If shadow is needed, keep it quiet and low-opacity.

Borders should be subtle enough to disappear at first glance but still organize the workflow when scanning.

## Current token direction

Use token names that belong to the product's world:

- `night-*` for calm low-glare canvas and card surfaces.
- `capture-black` for video/media wells and inset controls.
- `paper-100` / `ink-*` for result-table-like text hierarchy.
- `rail-gold` for the primary OCR/save action and procedural guidance.
- `rail-blue`, `route-green`, and `rail-magenta` only when classification or semantic state needs them.
- `line-soft` and `line-strong` for quiet border hierarchy.

## Spacing

Use an 8px base grid.

- Micro gaps: 8px.
- Control groups: 12px to 16px.
- Card padding: 20px.
- Section separation: 32px.
- Major page separation: 40px+.

Keep padding symmetrical unless content semantics require otherwise.

## Typography

Current project typography is appropriate for the domain:

- Display: `Dela Gothic One` for command/deck identity and large page titles.
- Body: `Zen Kaku Gothic New` for Japanese readability.
- Labels: small, bold, wide-tracked labels for procedural sections.
- Data/status: compact labels with clear Japanese text rather than internal codes.

Avoid treating typography as neutral infrastructure. Labels and instructions should reduce operational uncertainty.

## Component patterns to reuse

- **Capture Deck:** one preview/control surface that feeds images into trays.
- **Flow Nav:** a compact three-step rail above the work area: `01 撮影台`, `02 分類トレイ`, `03 OCR下書き`. Use it to ground the screen as a workflow, not as a dashboard.
- **Classification Station:** each tray should read like a small station/home: station number badge (`01`, `02`, `03`), Japanese tray name, media well, user-facing status badge, move controls, and draft/error output.
- **Primary OCR CTA:** one obvious action that performs OCR command + draft save.
- **Reset CTA:** should state exactly what will be cleared and show a visible completion notice.
- **Status badges:** always translate internal state into user-facing Japanese.
- **OCR readiness count:** show `OCR待ち n/3` near the primary OCR CTA so the user knows whether pressing the button will do anything.
