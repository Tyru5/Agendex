# agendex-cli

## 5.7.2

### Patch Changes

- c582062: Keep live CLI daemons recognized when macOS reports small boot-time timestamp drift.

## 5.7.1

### Patch Changes

- c3526f9: Keep cloud usage heartbeats under the server payload limit, surface failed syncs, and avoid double-counting multi-device usage.

## 5.7.0

### Minor Changes

- 21b78ca: Add an omp (oh-my-pi) adapter that indexes Plan-mode draft artifacts from omp session directories (`~/.omp/agent/sessions/**/local/*-plan.md`), with session metadata (workspace, session id, title) read from the session JSONL header. The adapter is default-enabled; existing installs pick it up via a v7 config migration. Landing page and agent color catalog now list omp.

## 5.6.0

### Minor Changes

- 92f63a1: Usage stats

## 5.5.0

### Minor Changes

- ec873a4: Add `agendex browse` to interactively select, view, save, or open a cloud plan on this machine

## 5.4.0

### Minor Changes

- 888c17f: Better WSL daemon detection

## 5.3.0

### Minor Changes

- 0ed676e: Add `agendex download` to fetch a cloud plan by id, name, or name + agent as Markdown or HTML

## 5.2.1

### Patch Changes

- 4d48347: Add Windows desktop native vs WSL plan environment selection (AGENDEX_HOME) and keep adapter home resolution cycle-free.

## 5.2.0

### Minor Changes

- 19cca5e: Add Command Code as a durable plan adapter for `~/.commandcode/plans`

## 5.1.0

### Minor Changes

- 232e555: Jump-to-source for validated plan path mentions, with forge source-file links when local validation is unavailable

## 5.0.0

### Major Changes

- 25ea538: Add remote UI updates to desktop application

## 4.2.1

### Patch Changes

- 5fd9cb1: handle character encodings on windows

## 4.2.0

### Minor Changes

- 57109b5: Git/PR plan linkage

## 4.1.5

### Patch Changes

- 3fccec6: Better handling of quitting the application

## 4.1.4

### Patch Changes

- e6fd096: desktop udpate controls to renderer process

## 4.1.3

### Patch Changes

- bc8272f: Updates to how we render daemon registry info

## 4.1.2

### Patch Changes

- 04a0e7a: bypass plan upload option and updates to plan integrity value proposition

## 4.1.1

### Patch Changes

- aa76aef: intelligence updates around plan quality

## 4.1.0

### Minor Changes

- 1511295: expanded plan ingestion

## 4.0.0

### Major Changes

- b7c73f0: add desktop-owned daemon worker

### Patch Changes

- d48db98: Fix v4 adapter migration so empty enabledAdapters lists stay empty (login no longer freezes installs to grok-only and skips catalog defaults).

## 3.4.0

### Minor Changes

- 1ced684: grok adapter addition

## 3.3.0

### Minor Changes

- 6063c6a: Make local bun redirection of agendex-cli always pick up global package manager installs

## 3.2.0

### Minor Changes

- 636a26d: resolved global cursor plan syncing issues

## 3.1.0

### Minor Changes

- 0e2396d: duplication of mutli-daemon filtering logic

## 3.0.0

### Major Changes

- 0d4d4aa: Logic to remove custom sync dirs via UI and cli

## 2.0.1

### Patch Changes

- f04249d: CLI status and help rendering layout changes

## 2.0.0

### Major Changes

- f2cf688: Complete refactor of UI, install scripts, docs route added, cloud sync logic updates, QoL changes

## 1.4.0

### Minor Changes

- 501c238: Upload fixes to the plan upload command

## 1.3.0

### Minor Changes

- b2eda4d: Better plan detection and syncing capabilities

## 1.2.0

### Minor Changes

- 1d12c82: upload command addition
- ef2e589: Add `agendex upload <path>` to push a single existing Markdown plan file directly to the cloud webapp via the authenticated sync flow, without running a full adapter scan. The plan id is derived from the absolute file path so re-uploading the same file updates the same cloud plan. Supports `--agent <name>` to override the plan's agent label and `--open` to open the uploaded plan in the browser. On success it prints a direct dashboard URL (`/dashboard?plan=<id>`); when not logged in or lacking a Cloud Pro subscription it fails fast with a clear, actionable message (including a pricing link), and low-value plans skipped by the server are reported explicitly.

## 1.1.0

### Minor Changes

- 29587bd: plannotator integration fixes

## 1.0.0

### Major Changes

- 754489b: Better integration with plannotator. QoL features and updates. New cli hooks and params

## 0.18.0

### Minor Changes

- 0f68ef9: Added sync provenance that includes the host machine's local IP address by default. Users can disable this in Account settings or by setting `AGENDEX_DISABLE_LOCAL_IP=1`.

### Patch Changes

- 83295a5: Updated auth callback page styling

## 0.17.0

### Minor Changes

- d051299: Added the ability for the cli to collect the IP address of the host machine from which the plan was sync'd to.

## 0.16.0

### Minor Changes

- 5bec2b5: upgrade cli option

## 0.15.0

### Minor Changes

- 7f42cc5: Plannotator integration cli updates

## 0.14.0

### Minor Changes

- 896f2d9: Updates to the filtering of plans/sessions with no content; prune logic.

## 0.13.0

### Minor Changes

- d108217: Updates to sync logic

## 0.12.0

### Minor Changes

- c3c4113: ability to add a new dir to sync

## 0.11.0

### Minor Changes

- 2801218: convex auth refresh update

## 0.10.1

### Patch Changes

- c0c7cf0: View shared plan url command addition

## 0.10.0

### Minor Changes

- 8197510: added open command

## 0.9.1

### Patch Changes

- 1baf3c6: daemon sync logic updates

## 0.9.0

### Minor Changes

- 27441e0: updates to config paths, env differences, fixes

## 0.8.5

### Patch Changes

- 31581a6: refactor sync logic, addedec chaching mechanism, pruning as well

## 0.8.4

### Patch Changes

- 153866d: smoke test update from cursor plan sync changes

## 0.8.3

### Patch Changes

- 1c65642: bugfix for deletion logic

## 0.8.2

### Patch Changes

- cefe824: update to the update logic hehe

## 0.8.1

### Patch Changes

- d2c15b8: Updadted README.md

## 0.8.0

### Minor Changes

- b15193c: Deletion of stale daemons

### Patch Changes

- cf04213: Updated smoke-release script

## 0.7.0

### Minor Changes

- f97ffb1: Daemon status info/view

## 0.6.0

### Minor Changes

- c4a0a86: mutli-daemon support

## 0.5.0

### Minor Changes

- 237a15d: Added Version flag and added daemon logic for more info on status flag

### Patch Changes

- 70d180e: Updated README

## 0.4.0

### Minor Changes

- d7c9505: updater lgoic

## 0.3.2

### Patch Changes

- ee62b2a: Updates to daemon logic and cli auth page

## 0.3.1

### Patch Changes

- aa704f3: Updated site URLS to new sub-domain

## 0.3.0

### Minor Changes

- f9089b8: Added new 'configure' command

## 0.2.0

### Minor Changes

- 9508283: Ship a production-ready npm release flow for `agendex-cli` with a Node-compatible runtime, clean generated publish artifact, Changesets release management, and GitHub Actions publish automation.
