# Agendex

Agendex indexes and displays plans/sessions produced by multiple coding agents.

## Install

```bash
bun install
```

## Run

```bash
# server (http://localhost:4890)
bun run dev

# client (http://localhost:5173)
bun run dev:client
```

## First-Run Adapter Selection

On first server start, Agendex asks which adapters to enable. The selection is persisted in:

`~/.agendex/config.json`

Default preselection includes adapters currently supported in this repo.

If startup runs without an interactive TTY (for example CI or daemon mode), Agendex automatically enables defaults and continues.

## Reconfigure Enabled Adapters

Use the startup flag to open adapter selection again:

```bash
bun run dev -- --configure-adapters
bun run start -- --configure-adapters
```

If `--configure-adapters` is used in a non-interactive environment, Agendex exits with an actionable error.
