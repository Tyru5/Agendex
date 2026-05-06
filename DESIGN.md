---
name: Agendex
description: A precise plan workspace for solo AI-coding power users and engineering teams.
colors:
  deep-grid-bg: '#041f1d'
  deep-grid-surface: '#082724'
  deep-grid-raised: '#102f2b'
  ivory-text: '#eef4e8'
  muted-sage: '#879891'
  hairline-grid: '#173d38'
  acid-lime: '#c8ff32'
  signal-orange: '#ff7a2f'
  light-bg: '#f7f9f3'
  light-surface: '#fcfdf8'
  light-text: '#121610'
  error-red: '#ef4444'
typography:
  display:
    fontFamily: 'Unbounded, Inter, system-ui, sans-serif'
    fontSize: '34px'
    fontWeight: 430
    lineHeight: 1.05
    letterSpacing: '0'
  headline:
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif'
    fontSize: '20px'
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: '0'
  title:
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif'
    fontSize: '14px'
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: '0'
  body:
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif'
    fontSize: '13.5px'
    fontWeight: 450
    lineHeight: 1.55
    letterSpacing: '0'
  label:
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif'
    fontSize: '11.5px'
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: '0'
  mono:
    fontFamily: 'SF Mono, JetBrains Mono, Fira Code, ui-monospace, monospace'
    fontSize: '12.5px'
    fontWeight: 500
    lineHeight: 1.55
    letterSpacing: '0'
rounded:
  xs: '5px'
  sm: '7px'
  md: '10px'
  lg: '14px'
  xl: '20px'
spacing:
  xs: '4px'
  sm: '8px'
  md: '12px'
  lg: '16px'
  xl: '24px'
  section: '40px'
components:
  button-primary:
    backgroundColor: '{colors.acid-lime}'
    textColor: '{colors.light-text}'
    rounded: '{rounded.md}'
    padding: '8px 14px'
  button-secondary:
    backgroundColor: '{colors.deep-grid-surface}'
    textColor: '{colors.ivory-text}'
    rounded: '{rounded.md}'
    padding: '7px 12px'
  panel:
    backgroundColor: '{colors.deep-grid-surface}'
    textColor: '{colors.ivory-text}'
    rounded: '{rounded.lg}'
    padding: '16px'
  chip:
    backgroundColor: '{colors.deep-grid-raised}'
    textColor: '{colors.muted-sage}'
    rounded: '{rounded.xs}'
    padding: '3px 8px'
---

# Design System: Agendex

## 1. Overview

**Creative North Star: "The Agent Plan Room"**

Agendex should feel like a quiet operations room for agent work: dense, composed, and legible at a glance. The supplied visual references show a dark green-black grid, disciplined vertical rhythm, ivory text, hairline separators, sparse controls, and a confident editorial tone. Borrow that restraint and structure, then adapt it to product work where users are searching, filtering, reading plans, comparing changes, and coordinating with teammates.

The references are strongest for brand surfaces, onboarding, empty states, public shared-plan pages, and high-level cloud collaboration moments. In the dashboard itself, use the same atmosphere through panel rhythm, hairline grid structure, precise type, and restrained accent states. Do not bring oversized editorial display type, carousel cards, or marketing composition into plan rows, filters, settings, comments, or command surfaces.

**Key Characteristics:**

- Deep green-black ambient surfaces with tinted ivory text.
- Fine grid and hairline borders used as structure, not decoration.
- Compact product density with calm spacing rhythm.
- Serif-like editorial drama translated cautiously through scale, not through UI labels.
- Acid lime kept as a rare action and selection signal, with orange reserved for conversion or high-priority calls to action.

## 2. Colors

The palette should move from the current graphite-and-lime base toward a deep editorial green-black system that still preserves Agendex's existing lime accent.

### Primary

- **Acid Lime** (#c8ff32): Current Agendex accent. Use for primary actions, selected states, sync success highlights, and rare active indicators. Its rarity is part of the signal.

### Secondary

- **Signal Orange** (#ff7a2f): Borrowed from the references as a warm conversion accent. Use on marketing CTAs and exceptional upgrade prompts only, not general dashboard actions.

### Neutral

- **Deep Grid Background** (#041f1d): Target dark canvas for brand, public, onboarding, and high-focus product surfaces.
- **Deep Grid Surface** (#082724): Panels, sidebar regions, command surfaces, and secondary dark containers.
- **Deep Grid Raised** (#102f2b): Hovered rows, elevated controls, selected low-emphasis chips, and nested tool areas.
- **Ivory Text** (#eef4e8): Primary text on dark surfaces. Avoid pure white.
- **Muted Sage** (#879891): Secondary text, helper copy, timestamps, metadata, and inactive controls.
- **Hairline Grid** (#173d38): Borders and structural dividers. It should read as architecture, not decoration.
- **Light Background** (#f7f9f3), **Light Surface** (#fcfdf8), **Light Text** (#121610): Light theme equivalents with a green tint. Avoid pure white.

### Named Rules

**The Grid as Architecture Rule.** Hairlines should define columns, panes, and reading zones. They should not become decorative dashed wallpaper in dense product screens.

**The Rare Signal Rule.** Lime appears on current state, primary action, and success. Orange appears on conversion or upgrade moments. Everything else earns attention through typography, spacing, and placement.

## 3. Typography

**Display Font:** Unbounded with Inter and system fallbacks  
**Body Font:** Inter with system fallbacks  
**Label/Mono Font:** SF Mono, JetBrains Mono, Fira Code, ui-monospace

**Character:** Product typography should stay mostly sans, compact, and highly legible. The references introduce an editorial mood, but Agendex should translate that through scale contrast and careful rhythm, not through fragile display fonts inside controls.

### Hierarchy

- **Display** (430, 34px, 1.05): Landing headlines, onboarding titles, empty-state headlines, public shared-plan page titles. Do not use in table rows, buttons, nav labels, settings labels, or plan metadata.
- **Headline** (650, 20px, 1.2): Page headers, major panel titles, settings section headings.
- **Title** (600, 14px, 1.35): Plan titles, popover headings, card titles, dialog titles.
- **Body** (450, 13.5px, 1.55): Plan prose, comments, helper copy, descriptions. Prose should stay within 65-75ch when it is meant to be read continuously.
- **Label** (650, 11.5px, 1.2): Filter labels, badges, compact metadata, tab labels. Letter spacing stays 0.
- **Mono** (500, 12.5px, 1.55): Code, CLI snippets, file paths, hashes, logs, and agent-generated plan fragments.

### Named Rules

**The Product Label Rule.** Never use display or serif-like styling for UI labels, buttons, filters, plan metadata, or data-dense controls. Keep those familiar and fast to parse.

## 4. Elevation

Agendex should be mostly flat and layered through tone, border, and spacing. The reference images use broad grids and large dark fields rather than heavy shadow. Use shadows only for transient overlays, active popovers, drag affordances, and focused command surfaces.

### Shadow Vocabulary

- **Ambient Popover** (`0 18px 40px rgba(0, 0, 0, 0.24)`): Menus, command palettes, status popovers, and small overlays.
- **Accent Lift** (`0 10px 26px rgba(200, 255, 50, 0.14)`): Primary action hover only, never inactive elements.
- **Editor Lift** (`0 8px 24px rgba(0, 0, 0, 0.18)`): Code blocks, markdown preview surfaces, and editor panels that need to stand apart from plan prose.

### Named Rules

**The Flat-By-Default Rule.** Surfaces rest flat. Elevation appears as a response to state or temporary layering.

## 5. Components

### Buttons

- **Shape:** Compact rounded rectangles, usually 7-10px. Keep cards at 8px or less unless the existing component requires more.
- **Primary:** Acid Lime background with Light Text, 8px 14px padding, 12-13px semibold label, and clear focus ring.
- **Hover / Focus:** Use subtle brightness, border-color shift, or one-pixel tonal lift. Motion should be 150-250ms with an ease-out curve.
- **Secondary / Ghost:** Transparent or Deep Grid Surface background with Hairline Grid border. No decorative glow.

### Chips

- **Style:** Small, dense, and textual. Use Deep Grid Raised or the light-theme hover layer, a thin border, 5px radius, and 11-12px labels.
- **State:** Selected chips may use lime text, a lime-tinted fill, or a visible check/icon. Do not rely on color alone.

### Cards / Containers

- **Corner Style:** Product panels should stay at 8-14px depending on density. Marketing or onboarding panels may use 20px when the surface has enough room.
- **Background:** Use tonal layers: background, surface, raised. Avoid nested card stacks.
- **Shadow Strategy:** Flat by default, shadow only for overlays and active state.
- **Border:** Hairline Grid or current `var(--border)`. Avoid colored side stripes.
- **Internal Padding:** Dense panels use 12-16px; reading panels use 20-24px; landing bands may use 40px and up.

### Inputs / Fields

- **Style:** Surface background, hairline border, 7-10px radius, 13px text, and clear placeholder contrast.
- **Focus:** Border or outline shift plus a non-color cue when possible. Keep focus visible in both light and dark themes.
- **Error / Disabled:** Error uses red plus text or icon. Disabled uses opacity and cursor state, not color alone.

### Navigation

- **Style:** Topbar and sidebar should feel like fixed instruments, not promotional headers. Use stable dimensions, compact labels, and predictable hover/active states.
- **Mobile Treatment:** Collapse structure deliberately. Preserve search and plan selection as primary actions; hide secondary metadata before hiding core navigation.

### Signature Component: Plan Workspace

The plan workspace should borrow the reference grid as a structural skeleton: sidebar, command/search region, plan list, outline, and viewer can align to a calm column system. Plan rows should remain product-dense and scannable, with source, recency, and status visible before decorative detail.

## 6. Do's and Don'ts

### Do:

- **Do** borrow the dark green-black atmosphere, ivory text, fine grid, sparse accent use, and precise spacing from the supplied references.
- **Do** reserve editorial scale for landing, onboarding, empty states, and public shared-plan pages.
- **Do** keep the dashboard familiar enough that users fluent in Linear, Figma, Notion, Raycast, and Stripe would trust it immediately.
- **Do** make plan title, source, recency, state, and available actions the first visual reads.
- **Do** maintain WCAG AA, keyboard-friendly controls, reduced-motion support, and status indicators that do not rely on color alone.
- **Do** use OKLCH for new authored CSS colors when changing implementation tokens, with hex only where tooling requires it.

### Don't:

- **Don't** turn the dashboard into a marketing page with giant hero typography, carousel cards, or ornamental news-section layout.
- **Don't** use cluttered project-management suites, toy AI dashboard visuals, bloated SaaS marketing patterns, excessive decorative chrome, generic task-board layouts, novelty AI-wrapper visuals, or loud analytics-product tropes.
- **Don't** use pure black or pure white in new visual work. Tint neutrals toward the green-black system.
- **Don't** use gradient text, decorative glassmorphism, hero-metric templates, identical icon-card grids, or modal-first flows.
- **Don't** use `border-left` or `border-right` greater than 1px as a colored accent on cards, list items, callouts, or alerts.
- **Don't** animate layout properties or add decorative motion that does not communicate state.
