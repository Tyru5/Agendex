# Changesets

This repo uses Changesets for `agendex-cli` releases.

- Create a release note with `bun run changeset`.
- Do not create changesets for `@agendex/desktop`; desktop releases are handled by the `Release Desktop` workflow and `desktop-v*` tags.
- Version bumps happen through the release PR generated from `main`.
- Publishing is handled by GitHub Actions from the generated `packages/cli/.release` artifact.
