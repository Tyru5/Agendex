---
version: 1
slug: "packages-web-src-client-components-landingpage-tsx"
primary_target: "packages/web/src/client/components/LandingPage.tsx"
related_targets: ["packages/web/src/client/components/DocsPage.tsx","packages/web/src/client/components/DownloadPage.tsx","packages/web/src/client/components/ChangelogPage.tsx","packages/web/src/client/components/ToolsUsedPage.tsx","packages/web/src/client/components/LegalPage.tsx","packages/web/src/client/components/landing/SubpageShell.tsx"]
---

# Landing surface brief

Scope: the public landing page (`/`) and its sibling marketing routes (/docs, /download, /changelog, /tools, /terms, /privacy). Mode: Persuade on `/`; Read on the siblings, which inherit the landing world.

Audience and job: a solo AI-coding power user with several agent CLIs whose plans sit unread in dotfile directories. Action: copy one install command. Cloud Pro is the on-page upsell, not the pitch. Proof: the mechanism itself, dramatized in the first viewport. Constraints: keep the Dex mascot (placement free); palette, type, and composition are open. Avoid the dev-SaaS default (dark, neon accent, hairline grid, framed screenshot), mascot-led play, and editorial-magazine styling.

## Direction contract

THESIS: Agendex is a column view. The plans are already files in folders; the page shows three real agent directories collapsing into one index column. It refuses the centered-headline-plus-framed-screenshot hero and the dark neon ground.

OWN-WORLD: Miller-column file browser grammar, played straight. Cool near-white screen ground, near-black ink, hairline column dividers, rows with document glyphs, dates and disclosure chevrons, a full-row selection bar. One committed color: saturated ultramarine-violet, drenching the index column and every selected state; no other accent. Night theme is the browser's own dark mode: cool near-black ground, same violet. One face at every scale, Schibsted Grotesk; mono only for real commands. Dex is the volume icon in the path bar.

STORY: the visitor recognizes their own `~/.claude`, `~/.codex`, `.cursor/plans` listings, watches them collate into one searchable column, and copies the install command that sits as that column's first row.

FIRST VIEWPORT: a window toolbar (brand as title, nav as toolbar buttons, theme switch, sign-in) then a four-column browser filling the viewport. Columns 1-3 (each ~20%): live-looking listings of synthetic plan files under the three real agent paths. Column 4 (~40%, violet): headline in white at 56-64px, one-line lede, the install command as the first row with a copy key, then the collated plan rows with agent icon, workspace, recency; Read the docs as a text row. Path bar at the bottom: Dex, breadcrumb, watched-agent count. Primary action is the install row.

FORM: filesystem column view, position 1 of 7 on the ordered list, presented as IMPECCABLE'S PICK against assigned index 4; user chose the pick. Seed key 11fb53b3. Code-led (no image generation available). Signature interaction: on first scroll (or after 1.6s idle) rows FLIP from the source columns into their slots in the index column, sources dim; hover links a source row to its twin; arrow keys move a Finder-style selection. Reduced motion: rows simply appear.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

Unresolved: whether the sibling pages adopt column view literally (docs as sidebar column + preview pane) or only the window chrome and row grammar. Default: docs and changelog adopt it literally; download, tools, legal take chrome and rows.
