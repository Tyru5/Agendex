# Changesets

This repo uses Changesets for `agendex-cli` releases.

- Create a release note with `bun run changeset`.
- Do not create changesets for `@agendex/desktop`; desktop releases are handled by the `Release Desktop` workflow and `desktop-v*` tags.
- Apply pending versions locally with `bun run version-packages`, then review and commit the generated changes.
- Build and validate the generated `packages/cli/.release` artifact with `bun run ci:local`.
- CLI package publishing is a separate manual operation; the local CI script never publishes.
