# Changesets

This repo uses Changesets for `agendex-cli` releases.

- Create a release note with `bun run changeset`.
- Version bumps happen through the release PR generated from `main`.
- Publishing is handled by GitHub Actions from the generated `packages/cli/.release` artifact.
