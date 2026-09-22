---
name: Agendex
description: A column-view file browser for the plans your coding agents already write.
# Scope: the marketing routes (/, /docs, /download, /changelog, /tools, /terms,
# /privacy). Hex values are sRGB approximations; the normative tokens are the
# OKLCH custom properties on `.landing-page` / `.dark .landing-page` in
# packages/web/src/client/index.css ("Landing page: the Column View world").
# The dashboard app keeps its own token set in `:root` / `.dark` and is not
# governed by this document.
colors:
  # Light (primary scene)
  screen-ground: '#f8fafc' # --landing-bg, oklch(98.4% 0.004 255)
  column-surface: '#fcfdff' # --landing-surface, oklch(99.4% 0.003 255)
  header-surface: '#edf0f4' # --landing-surface-raised, oklch(95.5% 0.006 255)
  ink: '#0c0f16' # --landing-text, oklch(17% 0.014 265)
  ink-muted: '#494d55' # --landing-muted, oklch(42% 0.014 265)
  ink-faint: '#60636a' # --landing-faint, oklch(50% 0.012 265)
  column-divider: '#d1d4d9' # --landing-border, oklch(87% 0.007 260)
  control-edge: '#adb1b8' # --landing-border-strong, oklch(76% 0.01 260)
  row-divider: '#e2e5e9' # --landing-border-subtle, oklch(92% 0.006 260)
  ultramarine-violet: '#5532c7' # --landing-accent AND --landing-index-bg (light), oklch(46% 0.215 285)
  ultramarine-pressed: '#4b2fb0' # primary hover: color-mix(in oklch, index-bg 88%, text)
  selection-ink: '#fbfbff' # --landing-accent-ink, oklch(99% 0.008 285)
  selection-wash: '#e8e8f9' # --landing-accent-soft: color-mix(in oklch, accent 9%, bg)
  error-red: '#be2517' # --landing-error (light), oklch(52% 0.19 30); token-error text only
  # Dark (the browser's night mode; same violet, split into text vs fill)
  night-ground: '#0a0c11' # --landing-bg dark, oklch(15.5% 0.012 265)
  night-surface: '#101318' # --landing-surface dark, oklch(18.5% 0.012 265)
  night-header: '#1a1d23' # --landing-surface-raised dark, oklch(23% 0.013 265)
  night-ink: '#ebeff4' # --landing-text dark, oklch(95% 0.008 260)
  night-ink-muted: '#a4a8ae' # --landing-muted dark, oklch(73% 0.01 260)
  night-ink-faint: '#83868c' # --landing-faint dark, oklch(62% 0.01 260)
  night-divider: '#26292f' # --landing-border dark, oklch(28% 0.012 265)
  night-control-edge: '#3f424a' # --landing-border-strong dark, oklch(38% 0.014 265)
  night-violet-text: '#8a7dfa' # --landing-accent dark, oklch(66% 0.18 285)
  night-violet-fill: '#411ea0' # --landing-index-bg dark, oklch(38% 0.19 285)
  night-error-red: '#f66e5c' # --landing-error dark, oklch(70% 0.17 30)
typography:
  display:
    fontFamily: "Schibsted Grotesk, -apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: 'clamp(34px, 3.9vw, 58px)'
    fontWeight: 750
    lineHeight: 1.02
    letterSpacing: '-0.028em'
  headline:
    fontFamily: "Schibsted Grotesk, -apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: 'clamp(26px, 3.1vw, 36px)'
    fontWeight: 750
    lineHeight: 1.06
    letterSpacing: '-0.025em'
  title:
    fontFamily: "Schibsted Grotesk, -apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: '23px'
    fontWeight: 750
    lineHeight: 1.1
    letterSpacing: '-0.02em'
  lede:
    fontFamily: "Schibsted Grotesk, -apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: '15px'
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: '0'
  body:
    fontFamily: "Schibsted Grotesk, -apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: '13.5px'
    fontWeight: 400
    lineHeight: 1.7
    letterSpacing: '0'
  row:
    fontFamily: "Schibsted Grotesk, -apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: '13px'
    fontWeight: 400
    lineHeight: 1.25
    letterSpacing: '0'
  label:
    fontFamily: "Schibsted Grotesk, -apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: '12px'
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: '0'
  mono:
    fontFamily: 'JetBrains Mono, SF Mono, ui-monospace, monospace'
    fontSize: '13px'
    fontWeight: 500
    lineHeight: 1.65
    letterSpacing: '0'
rounded:
  xs: '4px'
  sm: '5px'
  md: '6px'
  lg: '7px'
  xl: '8px'
spacing:
  cell: '12px'
  cell-wide: '14px'
  index-inset: '24px'
  row: '34px'
  pathbar: '36px'
  toolbar: '52px'
  gutter: 'clamp(16px, 4vw, 40px)'
  band: 'clamp(48px, 6vw, 72px)'
components:
  button-primary:
    backgroundColor: '{colors.ultramarine-violet}'
    textColor: '{colors.selection-ink}'
    rounded: '{rounded.md}'
    padding: '0 14px'
    height: '34px'
  button-primary-hover:
    backgroundColor: '{colors.ultramarine-pressed}'
    textColor: '{colors.selection-ink}'
  button-secondary:
    backgroundColor: '{colors.column-surface}'
    textColor: '{colors.ink}'
    rounded: '{rounded.md}'
    padding: '0 14px'
    height: '34px'
  button-secondary-hover:
    backgroundColor: '{colors.header-surface}'
    textColor: '{colors.ink}'
  button-compact:
    backgroundColor: '{colors.column-surface}'
    textColor: '{colors.ink}'
    rounded: '{rounded.md}'
    padding: '0 10px'
    height: '30px'
  copy-key:
    backgroundColor: '{colors.selection-ink}'
    textColor: '{colors.ultramarine-violet}'
    rounded: '{rounded.sm}'
    padding: '0 10px'
    height: '32px'
  toolbar-link:
    backgroundColor: 'transparent'
    textColor: '{colors.ink-muted}'
    rounded: '{rounded.md}'
    padding: '0 10px'
    height: '30px'
  toolbar-link-current:
    backgroundColor: '{colors.selection-wash}'
    textColor: '{colors.ultramarine-violet}'
  column-head:
    backgroundColor: '{colors.header-surface}'
    textColor: '{colors.ink-muted}'
    typography: '{typography.label}'
    padding: '0 12px'
    height: '30px'
  row:
    backgroundColor: 'transparent'
    textColor: '{colors.ink}'
    typography: '{typography.row}'
    padding: '0 12px'
    height: '34px'
  row-linked:
    backgroundColor: '{colors.selection-wash}'
    textColor: '{colors.ink}'
  listing:
    backgroundColor: '{colors.column-surface}'
    textColor: '{colors.ink}'
    rounded: '{rounded.xl}'
    padding: '0'
  listing-head:
    backgroundColor: '{colors.header-surface}'
    textColor: '{colors.ink}'
    padding: '0 14px'
    height: '32px'
  workspace-tag:
    backgroundColor: 'transparent'
    textColor: '{colors.selection-ink}'
    rounded: '{rounded.xs}'
    padding: '1px 6px'
  input-token:
    backgroundColor: '{colors.screen-ground}'
    textColor: '{colors.ink}'
    typography: '{typography.mono}'
    rounded: '{rounded.md}'
    padding: '10px 12px'
  callout:
    backgroundColor: '{colors.header-surface}'
    textColor: '{colors.ink-muted}'
    rounded: '{rounded.lg}'
    padding: '12px 16px'
  pathbar:
    backgroundColor: '{colors.header-surface}'
    textColor: '{colors.ink-muted}'
    padding: '0 12px'
    height: '36px'
  statusbar:
    backgroundColor: '{colors.header-surface}'
    textColor: '{colors.ink-muted}'
    padding: '14px clamp(16px, 4vw, 40px)'
---

# Design System: Agendex

## Overview

**Creative North Star: "The Column View"**

The marketing site is a Miller-column file browser, played straight. Plans are already files in folders; the page shows three real agent directories (`~/.claude/plans`, `~/.codex/tasks`, `.cursor/plans`) collating into one index column, and the visitor recognises their own listings before reading a word of copy. Everything on these routes is drawn from that browser's vocabulary: a window toolbar, column heads with item counts, 34px document rows with a glyph, a name and a right-aligned date, a full-row selection bar, a path bar, and a status-bar footer. There is no hero in the marketing sense; the first viewport is the mechanism.

The material is a cool near-white screen with near-black ink and hairline column dividers. One color is committed: a saturated ultramarine-violet that drenches the index column and every selected or primary state. Nothing else is tinted. Light is the primary scene; `.dark` is the browser's own night mode (cool near-black ground, the same violet split into a lighter text step and a deeper fill step), not a mood swap. The page is dense in the way a file browser is dense: many rows, short labels, tabular numerals, and enough hairlines to make columns read as architecture.

Confirmed rejections: the dark-plus-neon dev-SaaS ground, hairline-grid wallpaper, the framed-screenshot hero, editorial serif or magazine styling, and mascot-led play. Dex appears exactly once, as the volume icon in the path bar.

**Key Characteristics:**

- Miller-column browser grammar as the whole layout, not a decorative motif.
- Cool near-white ground, near-black ink, hairline dividers at three strengths.
- One committed color (ultramarine-violet) for the index column, selection, current-nav and primary controls; no second accent.
- One face, Schibsted Grotesk, at every scale; JetBrains Mono only for real commands and paths.
- Flat surfaces; depth is column adjacency and tonal header bars, never shadow.
- Illustrative data is always labeled "illustrative" in the column head or foot.

## Colors

A cool, low-chroma neutral scale (hue 255-265) with a single saturated violet that carries every state of emphasis.

### Primary

- **Ultramarine Violet** (`#5532c7`, oklch(46% 0.215 285)): the one committed color. As `--landing-accent` it is text on ground: the brand's period, current-nav label, doc-link text, preview headings, check glyphs, focus rings, text selection. As `--landing-index-bg` it is the fill: the entire index column, primary actions, the selected install tab and pricing/package-manager toggles. In light both tokens share this value; in dark they split into **Night Violet Text** (`#8a7dfa`, oklch(66% 0.18 285)) and **Night Violet Fill** (`#411ea0`, oklch(38% 0.19 285)) so text stays legible and the column stays deep.
- **Selection Ink** (`#fbfbff`, oklch(99% 0.008 285)): text and glyphs on any violet fill. Inside the index column it is also the base for every translucent layer (`color-mix` of selection ink at 10-40% over the fill) that builds the column head, the install command well, row hover, and the workspace tag border.
- **Selection Wash** (`#e8e8f9`, color-mix of the accent at 9% into ground): the hover-link tint on a source row and the current-page toolbar button. Weak on purpose; it says "this row is related", not "selected".

### Neutral

- **Screen Ground** (`#f8fafc`): the page and document background, painted onto `<body>` so nothing off-token shows past the root.
- **Column Surface** (`#fcfdff`): every column, listing body, toolbar and secondary button.
- **Header Surface** (`#edf0f4`): column heads, listing heads, path bar, status bar, hover fill on links and buttons, callouts. The one tonal step that tells a bar from a body.
- **Ink** (`#0c0f16`), **Ink Muted** (`#494d55`), **Ink Faint** (`#60636a`): row names and headings; ledes, body copy, nav labels; dates, counts, glyphs and metadata. Faint is tuned to hold 4.5:1 on ground and surface; do not lighten it.
- **Column Divider** (`#d1d4d9`), **Control Edge** (`#adb1b8`), **Row Divider** (`#e2e5e9`): column and section hairlines; the border on buttons and inputs; the hairline between rows inside one listing.
- **Error Red** (`#be2517` light, `#f66e5c` dark): `--landing-error`, used in exactly one place, the token-error line of the connect modal. It is a status voice, not an accent, and must not appear elsewhere.

### Named Rules

**The One Color Rule.** Ultramarine-violet is the only hue on the page. A new element that needs emphasis takes the violet as text on ground, the violet as a fill with selection ink on top, or nothing. It never takes a second color.

**The Fill Ink Rule.** Anything painted with `--landing-index-bg` sets its text and glyphs to `--landing-accent-ink`, and all inner structure (heads, wells, hover, tags) is selection ink at a translucent percentage. No neutral tokens inside a violet fill.

**The Dark Is Night Mode Rule.** Dark only remaps the neutral scale and splits the violet into text and fill steps. It adds no glow, no gradients, no new hue.

## Typography

**Display Font:** Schibsted Grotesk (with -apple-system, Segoe UI, system-ui, sans-serif)
**Body Font:** Schibsted Grotesk (same face, same fallbacks)
**Label/Mono Font:** JetBrains Mono (with SF Mono, ui-monospace, monospace), loaded at 400/500/600

**Character:** One grotesk at every size, from a 58px headline to an 11px workspace tag. The large sizes go heavy (750) and tight (-0.028em) so the headline reads as a window title set big, not as an editorial display face. Numerals in rows, heads and the path bar are tabular so dates and counts align.

### Hierarchy

- **Display** (750, clamp(34px, 3.9vw, 58px), 1.02, -0.028em): the one `h1`, inside the index column, in selection ink, max 14ch, balanced. Nothing else uses it.
- **Headline** (750, clamp(26px, 3.1vw, 36px), 1.06, -0.025em): section `h2` on `/` and the page `h1` on subpages (which bumps the size to clamp(30px, 3.6vw, 42px)).
- **Title** (750, 23px, 1.1, -0.02em): subpage section headings; dense reference sections drop to 19px/1.2. Sub-headings are 700 at 15px.
- **Lede** (400, 15px, 1.6): the one-line paragraph under a headline, muted ink, max 60ch, `text-wrap: pretty`.
- **Body** (400, 13.5px, 1.7): reading copy on subpages and in disclosure answers, muted ink, max 68ch. Listing rows with prose use 13.5px/1.5.
- **Row** (400, 13px, 1.25): file rows and toolbar links. Dates and counts beside them are 12px faint ink; workspace tags are 11px at 600.
- **Label** (600, 12px, 1.2): column heads, listing heads (12.5px), install tabs (11.5px), form labels. Never uppercase, never letter-spaced.
- **Mono** (500, 13px in commands; 12.5px in blocks and the preview pane; 11.5px in column heads): only for real commands, real paths, and rendered plan markdown. Pseudo-code, decorative brackets or labels in mono are off-world.

### Named Rules

**The One Face Rule.** Schibsted Grotesk at every scale. Emphasis comes from weight (400 / 500 / 600 / 700 / 750) and size, never from a second family.

**The Real Mono Rule.** JetBrains Mono appears only where a user could copy the text into a shell or a file: install commands, agent paths, `agendex` subcommands, and the preview pane's markdown. A label set in mono is a mistake.

**The No Eyebrow Rule.** Headings stand alone. No kicker, eyebrow or small-caps label sits above an `h1` or `h2`; the column head is the only thing that ever labels a region.

## Layout

The marketing shell is toolbar (52px, sticky, hairline below) then content then status bar. On `/` the content opens with the browser: a four-column grid filling the viewport (`100svh - toolbar - pathbar`, clamped 720-1040px) at `repeat(3, 1fr) 1.95fr`, so the three source columns take about 20% each and the index column about 40%. Each column is a flex stack: 30px head, rows, and a 28px foot pushed to the bottom. Rows are a `18px 1fr auto` grid (glyph, name, date) at a 34px minimum height with 12px inline padding; index rows widen to `20px 1fr auto auto` (agent icon, name, workspace tag, date) with 24px padding. The index column adds an intro block (28px 24px 18px), the install row (14px 24px 16px), a scrolling row list with a 28px bottom fade, and a pinned link list. The path bar (36px, header surface) sits directly below the browser: Dex, `Agendex › Local index › 3 sources watched`, agent count on the right.

Sections below the browser are bands with `clamp(48px, 6vw, 72px)` vertical and `clamp(16px, 4vw, 40px)` horizontal padding, a hairline between bands, and a 1200px inner width. Inside a band, content is a headline, a lede, then either a bordered listing (`.landing-list`) or a columns panel (`.landing-columns`, a bordered grid whose children are separated by column dividers). Two-column bands use asymmetric splits (`0.8fr 1.2fr`, `300px 1fr`, `0.9fr 1.1fr`), text left, listing right.

Subpages share the toolbar, a path bar directly beneath it (`Agendex › Docs`), a reading region at max 1200px with `clamp(36px, 5vw, 56px)` vertical padding, and the status bar. Section headings sit on a hairline with 40px rhythm (28px when dense).

Responsive: at 960px and below the browser collapses to a stacked list view. The index column moves first; the three source columns become a horizontally snapping strip at `minmax(78vw, 1fr)` each; column dividers turn into bottom hairlines; inner padding drops from 24px to 18px; the columns panel goes single-column. At 860px the toolbar nav folds into a menu button that opens a stacked link list under the toolbar. At 640px the path-bar status hides and the install command wraps with the copy key dropping under it.

## Elevation & Depth

Flat. There are no shadows on any marketing surface; depth is column adjacency and the single tonal step from column surface to header surface. A bar (column head, listing head, path bar, status bar) is a header-surface strip with a hairline under it; a body is column surface; the index column is a violet fill. Overlays are the sole exception: the connect modal floats a listing over a 40% ink scrim with one ambient shadow.

### Shadow Vocabulary

- **Modal lift** (`box-shadow: 0 18px 40px rgba(0, 0, 0, 0.24)`): the connect-to-dashboard modal only.

### Named Rules

**The Adjacency Rule.** Two regions are separated by a 1px divider, a tonal header bar, or the violet fill, never by a shadow, a gradient or a border thicker than a hairline.

## Shapes

Rectilinear with barely-rounded corners; the radius is a hint that a thing is a control, never a pill. Rows, columns, bars and the browser itself are square. Controls take 6px (buttons, toolbar links, the token input); small keys take 5px (copy key, install tab, toggle segments); tags and inline code take 4px; the install command well and callouts take 7px; a standalone listing or columns panel takes 8px with `overflow: hidden` so its head clips cleanly. Every listing is bordered with the column divider, every control with the control edge, and rows inside a listing with the row divider. No borders thicker than 1px, no colored side stripes, no outline-only ghost buttons except the modal's Cancel.

## Components

### Window toolbar
A 52px sticky bar in column surface with a hairline below. Brand at left ("Agendex" 700/15px with a violet period), nav as toolbar buttons in the middle (500/13px muted ink, 30px tall, 6px radius, header-surface hover, selection-wash fill and violet text when current), theme switch and the host's auth slot at right. Below 860px the nav becomes a compact secondary button with an inline SVG menu glyph that toggles a stacked list.

### Actions
- **Shape:** 6px radius, 34px tall, 1px control-edge border, 600/13px label, 120ms ease on background, border and color.
- **Primary:** violet fill (`--landing-index-bg`) with selection ink; hover mixes 12% ink into the fill. Inside the index column the roles invert: primary is selection ink with violet text.
- **Secondary:** column surface with control-edge border and ink; hover to header surface.
- **Compact:** 30px tall, 10px inline padding, 12.5px label; used for the toolbar menu and copy buttons in listings.
- **Full:** stretches to the listing width (pricing CTAs, modal submit).
- **Disabled:** 70% opacity, `cursor: wait`, spinner replaces nothing.
- **Focus:** every link, button and input shows a 2px violet outline at 2px offset.

### Miller columns
- **Column:** column surface, right hairline, flex stack.
- **Column head:** 30px, header surface, hairline below, 600/12px muted ink; the path in mono 500/11.5px with ellipsis, the count in faint ink, pinned right.
- **Row:** 34px grid of glyph, name, date; ink name with ellipsis, faint 12px date, faint document glyph. Hover on either a source row or its index twin sets `is-linked` on both: selection-wash background, violet glyph and date.
- **Column foot:** 28px, faint 11.5px, source label left and `N items · illustrative` right.

### Index column
The destination column, drenched in violet fill with selection ink. Its head, intro divider, install well, tag borders and hover states are all selection ink at 10-40% over the fill. Rows carry an agent icon, name, a workspace tag (11px/600 in a 4px-radius translucent-ink border) and date. Arrow keys move an `is-selected` bar (selection ink at 16%) Finder-style; the list is a `listbox` with `option` rows. The row list scrolls with a thin translucent scrollbar and fades to the fill over its last 28px. A pinned link list at the foot renders text rows (600 weight, trailing chevron) for Read the docs, Connect a running dashboard, and Agendex Desktop.

### Install row + copy key
The install command is the index column's first row. Two 11.5px/600 tabs (macOS / Linux, Windows; the selected one is selection ink at 18%) sit above a 46px well: translucent-ink fill, 30% ink border, 7px radius, prompt glyph and command in mono 13px, and the **copy key** at right, a 32px selection-ink key with violet 700/12px text that flips its inline SVG and label to Copied for 1.4s. A 12.5px follow-up line names the next three `agendex` commands in mono.

### Path bar
36px header-surface strip, hairline below, 12px muted ink with tabular numerals. Crumbs: Dex (20px, theme-matched) then `Agendex` in 600 ink, chevrons in faint ink, and the current location; a faint status string right that hides under 640px. On `/` it sits below the browser; on subpages it sits directly under the toolbar and has no Dex.

### Listing
The section-level building block (`.landing-list`): a bordered 8px-radius column-surface box with a **listing head** (32px, header surface, 600/12.5px ink, faint counter right) and **listing rows** (`20px 1fr` grid, 12px 14px padding, 13.5px/1.5, row-divider hairlines, a faint 600/12px numeral or glyph in the first cell, muted prose paragraphs). Pricing volumes, the sources catalogue, the FAQ and the package-manager installer are all listings. A listing whose rows are file rows reuses the 34px row.

### Columns panel
`.landing-columns`: a bordered 8px-radius grid whose children are separated by column dividers, used to show the local index, a preview pane and cloud review side by side. Collapses to stacked, hairline-separated blocks under 960px.

### Preview pane
The browser's Quick Look: 14px padding, mono 12.5px/1.7 in muted ink, markdown headings (`.h`) in violet 600, and the plan title (`.t`) in the grotesk at 700/15px ink.

### Disclosure rows
FAQ items: a 48px button row with a chevron in the first cell and a 600/14px question, header-surface hover; the chevron rotates 90° and turns violet when expanded (180ms). The answer expands via `grid-template-rows: 0fr → 1fr` over 220ms and reads as body copy (13.5px/1.7, muted, 68ch) indented under the question.

### Toggles and tabs
Segmented controls (billing cadence, package manager) are a 7px-radius header-surface tray with 30px, 5px-radius segments at 600/12.5px muted ink; the active segment takes violet fill with selection ink. Install-platform tabs inside the index column use the translucent-ink variant.

### Inputs
One field exists: the CLI token input in the connect modal. Screen-ground background, control-edge border, 6px radius, mono 13px, faint placeholder, violet caret; focus swaps the border to violet. Errors render a 12px/600 line in error red with `role="alert"`, plus the `aria-invalid` state.

### Modal
The connect modal is a 430px listing (head + 20px-padded body) over a 40% ink scrim with the modal-lift shadow, closing on Escape or scrim click.

### Status-bar footer
Header-surface strip, 14px vertical and gutter horizontal padding, 12.5px muted ink: copyright left, a wrapping nav of 600-weight links right (hover to ink), GitHub with its inline SVG.

### Reading primitives (subpages)
Body paragraphs (13.5px/1.7, 68ch, muted), callouts (header surface, column-divider border, 7px radius, 12px 16px padding), text links (600 violet with a 40% violet underline that saturates on hover), inline code (mono 12px, header surface, row-divider border, 4px radius) and code blocks (mono 12.5px/1.65, column surface, 6px radius), numbered lists as listing rows, bullet lists with a 4px faint dot.

### Signature interaction: collation
On `/` at widths above 960px, index rows start hidden while `is-collating` is set. On the first scroll or after 1.6s idle, each index row FLIPs from its source twin's bounding box into its slot: 640ms, `cubic-bezier(0.22, 1, 0.36, 1)`, 34ms stagger per row, opacity 0 → 0.6 → 1, while the three source columns dim to 55% (400ms). Hovering any row scrolls its twin into view and links the pair. With `prefers-reduced-motion: reduce`, or on narrow viewports, rows simply appear. All motion on these routes is opacity and transform, plus the disclosure's grid-row expansion and 120ms colour transitions on controls.

## Do's and Don'ts

### Do:

- **Do** build every new region from the browser vocabulary: a column head or listing head (header surface, 600 label, faint count), rows at 34px, hairline dividers, a foot or status line.
- **Do** use ultramarine-violet as text on ground (`--landing-accent`) or as a fill with selection ink (`--landing-index-bg` + `--landing-accent-ink`); nothing else carries emphasis.
- **Do** keep every surface flat; separate regions with 1px dividers or the header-surface tonal step.
- **Do** set commands, paths and rendered plan markdown in JetBrains Mono, and label every synthetic listing "illustrative" in its head or foot.
- **Do** keep numerals tabular in rows, heads and the path bar, and keep dates right-aligned.
- **Do** honour reduced motion: rows appear without the FLIP, and no motion touches layout properties.
- **Do** show a 2px violet focus ring at 2px offset on every focusable element, in both themes.

### Don't:

- **Don't** use a dark ground with a neon accent, gradient text, glow or glassmorphism; dark is the browser's night mode, nothing more.
- **Don't** lay a hairline grid, dot grid or texture behind content; hairlines only divide real columns and rows.
- **Don't** open a page with a centered headline over a framed product screenshot; the first viewport is the mechanism itself.
- **Don't** introduce a serif, an editorial display face, or magazine composition (pull quotes, drop caps, kickers).
- **Don't** put a kicker, eyebrow or small-caps label above a heading; headings stand alone.
- **Don't** add a second accent, a colored side stripe, or a border thicker than 1px; error red is reserved for the connect modal's error line.
- **Don't** use unicode characters as icons; every glyph is an inline SVG (document, chevron, check, copy, menu, agent marks).
- **Don't** let Dex appear anywhere but the path bar, or lead a section with the mascot.
- **Don't** present illustrative rows, comments or prices as real data without the "illustrative" label.
