---
'agendex-cli': minor
---

Add an omp (oh-my-pi) adapter that indexes Plan-mode draft artifacts from omp session directories (`~/.omp/agent/sessions/**/local/*-plan.md`), with session metadata (workspace, session id, title) read from the session JSONL header. The adapter is default-enabled; existing installs pick it up via a v7 config migration. Landing page and agent color catalog now list omp.
