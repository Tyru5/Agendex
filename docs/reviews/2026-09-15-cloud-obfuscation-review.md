# Cloud Obfuscation merge review

Reviewed branch: `feat/cloud-obfuscation-security-spike`.
Merged main: `661ab4847acf6980abef70eb82404fab3f6297c7` (refetched before completion).

## Outcome

Merged main's security, authorization, deletion, DTO, and usage changes with the Obfuscation implementation. Repeated specialist and independent adversarial review, fixing the actionable findings below. The last independent pass found no residual actionable findings in the corrected paths. This is a scoped engineering review, not an independent cryptographic certification.

The review skill prompted separate custody, API, migration/deletion, browser, testing, and adversarial passes. The independent reviewer examined test fixtures in summary mode; executable regression coverage was verified separately.

## Resolved findings

- **Key custody:** use a supported Linux Secret Service probe; reject Electron's insecure `basic_text` backend; pass macOS Keychain input without exposing keys in process arguments; surface failed key deletion. Encryption preserves original Unicode payload bytes.
- **Locked clients:** invalidate decrypted view caches, fence stale asynchronous unlocks, enforce the expected key epoch, and reject plaintext fallbacks while privacy status is loading.
- **Editing and history:** encrypt rename/editor writes, preserve private summary fields, distinguish live-plan and history encryption contexts, validate epochs, and block saving unreadable/locked placeholders.
- **Contracts and access:** retain encrypted fields through Convex validators and DTOs, preserve password-protected share proofs, block existing share links as soon as encryption is enabled, and allow authorized workspace-member comments without share links.
- **Sealing and rotation:** preserve encrypted attachment identity and optional fields; resume partially committed blobs and audits; renew leases; use locally owned runner leases; reject stale row snapshots atomically instead of overwriting concurrent edits. Batches are capped at ten rows.
- **Audit and privacy:** validate optional encrypted fields; erase normalized titles and old usage snapshots; reconcile every workspace schema field with the privacy inventory.
- **Deletion:** retain main's bounded durable cleanup, add crypto grants/identities/settings and pending-invite cleanup, prevent recreation during deletion, preserve foreign workspaces, and delete encrypted storage without unlocking.
- **Usage integration:** cloud usage sync is explicitly unavailable with Obfuscation until it has an encrypted format. Local usage is unchanged; clients fail closed rather than silently acknowledging dropped snapshots.
- **Merge compatibility:** fix affected Bun declarations, strict TypeScript contracts, publishing DTOs, export stream types, UI imports, and the installed Better Auth provider's type mismatch without changing authentication behavior.

## Verification

| Check                                   | Result                                                   |
| --------------------------------------- | -------------------------------------------------------- |
| Complete Bun suite                      | 1,102 passed, 0 failed, 146 files                        |
| Convex runtime suite                    | 20 passed, 0 failed, 4 files                             |
| TypeScript                              | Shared, CLI, EE, Convex, desktop, web, and OSS app pass  |
| Frozen dependency install               | Pass                                                     |
| Formatting                              | All Git-tracked/new project files pass                   |
| Lint                                    | Pass; 84 warnings, 0 errors                              |
| CLI release checks/build/package/smoke  | Pass                                                     |
| Cloud frontend production build         | Pass; dependency/chunk-size warnings remain              |
| Local Convex schema/function deployment | Pass against an isolated anonymous backend using Node 24 |
| Generated API                           | Matches the isolated successful code generation          |
| Changeset requirement                   | Pass; existing CLI minor changeset                       |
| Merge markers / whitespace              | No conflict markers; diff check passes                   |

Regression coverage includes stale tag/collection/annotation writes and cursor preservation, consecutive attachment rotations, old optional envelope rejection, locked heartbeats retaining their true epoch, encrypted comments and membership revocation, encrypted editor/history contracts, and account deletion across bounded batches.

## Verification boundaries

- No native OS keychain write/read cycle was performed. Platform custody tests simulate command/backend behavior; source compatibility was checked separately.
- No authenticated browser end-to-end or packaged desktop run was performed.
- The configured cloud development deployment rejected code generation analysis because `BETTER_AUTH_TRUSTED_ORIGINS` is missing while production auth policy is selected. Its environment was not changed. Local deployment validation used an isolated temporary project and development auth policy.
- The root unrestricted formatting command also scans an ignored, tool-generated `.impeccable/hook.cache.json`; that unrelated cache was left untouched. The tracked-file formatting gate and CLI release formatting gate pass.
- This merge was not pushed. CI on the new merge commit has not run; older green CI does not validate this commit.
- Obfuscation rollout gates remain in place. This review does not authorize enabling the feature in production or changing cloud credentials/configuration.
