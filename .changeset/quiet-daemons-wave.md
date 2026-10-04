---
'agendex-cli': patch
---

`agendex status` on WSL now lists the Windows desktop-app daemon beside a running CLI daemon instead of hiding it, detects WSL via /proc/version when the shell lacks `WSL_*` env vars (so heartbeats report `wsl` and the Windows probe still runs), and falls back to the absolute PowerShell path when it is not on PATH.
