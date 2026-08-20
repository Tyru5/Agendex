# Obfuscation threat model

Status: implementation complete; new setup remains disabled unless `OBFUSCATION_ROLLOUT` explicitly allowlists the owner.

## Claim

Once sealing finishes, Agendex servers cannot decrypt an obfuscated workspace's user content. Encryption and decryption happen in the web client, desktop app, or CLI. Convex stores ciphertext, wrapped keys, and the server-readable metadata listed below.

This is a server-access guarantee. It is not protection against malicious client code or an unlocked, compromised computer.

## Content that must be encrypted

- Plan titles, bodies, paths, workspaces, metadata, and version snapshots.
- Comments, annotations, replacements, writeback feedback, and revised content.
- Tag and collection names and descriptions.
- Plan-link values and URLs.
- Attachment names, content types, and bytes.
- User-supplied agent avatars.
- Daemon hostnames and IP addresses.
- Raw sync identities that contain paths, session IDs, or project labels.
- Readable account exports.

The schema inventory test must fail when a new workspace-owned field has no explicit classification.

## Data the server still sees

- Better Auth identities, OAuth IDs, emails, roles, and invitation emails.
- Stripe customer and subscription fields.
- Owner, member, record, and relation IDs.
- Agent, format, status, version, timestamps, and key epoch.
- Ciphertext length, record counts, and access patterns.
- Opaque keyed equality tokens.
- The `lowValue` boolean used for server-side visibility filtering.

The settings modal and documentation must disclose this list. Marketing copy must say, "Agendex servers cannot decrypt your obfuscated cloud content." It must not claim protection from an infected device or malicious client release.

## Attackers in scope

### Database reader

An attacker can read current Convex tables, indexes, backups, and `_storage` objects. They must not recover user content or test guesses against unkeyed title, path, or content hashes.

### Database writer

An attacker can modify or swap ciphertext. Associated data must bind each ciphertext to its workspace, table, record, field, format version, and key epoch. The client must report authentication failure as corruption. It must never turn that failure into an empty title or body.

### Old client

An authenticated but obsolete CLI, browser tab, or desktop build may attempt a plaintext write after sealing starts. The server must reject it before changing data and return an upgrade-required error.

### Removed member

A removed member may keep anything they decrypted before removal. After authorization is revoked and key rotation finishes, their old key must not decrypt the current database.

## Attackers outside the claim

- Browser extensions, malware, screen capture, and memory inspection on an unlocked device.
- Malicious JavaScript or a compromised signed desktop release.
- An authorized user copying plaintext.
- A weak passphrase attacked offline using the stored wrapper.
- Historical ciphertext retained with a key copied before rotation.
- Traffic analysis based on timing, counts, and ciphertext sizes.

## Key rules

- Generate each workspace data-encryption key with a client CSPRNG.
- Derive separate data, equality-token, and invitation keys with HKDF.
- Use XChaCha20-Poly1305 with a new random 24-byte nonce for every encryption.
- Bind canonical associated data to the workspace, table, stable record ID, encrypted slot, and key epoch.
- Never expose an ordinary encryption API that accepts a caller-provided nonce.
- Replace the current custom `contentHash`, raw sync identity, local plan ID, and continuity key with HMAC-SHA-256 tokens for encrypted rows.
- Never log plaintext, passphrases, recovery secrets, URL fragments, decrypted values, or raw keys.

## Passphrase KDF decision

Noble warns that pure-JavaScript Argon2 is slow. The spike compared:

1. Scrypt at `N=2^17, r=8, p=1` or stronger.
2. `hash-wasm` Argon2id at no less than 19 MiB, two iterations, and one lane.

The selected KDF must run outside the browser main thread, take roughly 500 to 1,500 ms on the reference desktop, fail cleanly under memory pressure, and store versioned parameters with the wrapped key.

Run the Bun benchmark:

```bash
bun run bench:obfuscation:kdf
bun run bench:obfuscation:kdf -- --runs 1 --json
```

Record the CPU, OS, Bun version, parameters, duration, and RSS change. Use a fresh process for each memory measurement because the JavaScript or WASM runtime may retain working memory between runs.

### Decision and reference measurement

Version 1 writes Argon2id wrappers using pinned `hash-wasm` with 64 MiB, 11 iterations, one lane, a 16-byte random salt, and a 32-byte output. That exceeds the OWASP minimum of 19 MiB, two iterations, and one lane. The package has no dependencies, bundles the WASM instead of fetching it at runtime, and publishes its C-based build process. The client retains a bounded scrypt reader for compatibility, but new owner and member wrappers use Argon2id. Every parameter is stored with the wrapper so a future client can raise the cost without re-encrypting content.

On 2026-08-19, Bun 1.3.14 on an Apple M1 Max derived the shipped parameters in 499 ms with about 80 MiB peak RSS growth. The built production Worker completed the prewarmed path in 507 ms in an active T3 Chromium preview. A hidden preview throttled the Worker to roughly 2.7 seconds, so UI progress must remain visible and no correctness timeout may assume foreground scheduling. The rejected pure-JavaScript scrypt implementation took about 7.2 seconds in the same preview. New setup remains rollout-gated until the shipped parameters pass the documented Safari, Firefox, Windows, and lower-memory canary matrix; unlock, recovery, export, and deletion for existing encrypted workspaces are never gated.

## Recovery

The owner generates a random recovery secret. The downloaded kit contains that secret and a recovery-wrapped workspace key. Enable remains blocked until the owner re-imports the downloaded file and proves it recovers the same key.

Agendex cannot recreate a lost recovery secret. An unlocked owner may create another kit, but an old kit stays valid until the workspace key rotates.

## Migration rules

- Add optional encrypted fields before changing any existing validator.
- Ship readers for plaintext and ciphertext before any workspace can enable Obfuscation.
- At the start of sealing, atomically block share access and reject plaintext writes.
- Encrypt existing content only in an unlocked client. Convex never receives the workspace key.
- Commit sealed records with compare-and-swap checks.
- Write `enabledAt` only after the full inventory reports no plaintext, live share link, or old key epoch.
- Once the first workspace seals, every deploy and rollback target must understand encrypted records.
- Never roll a workspace back to plaintext.

## Stop conditions

Stop rollout and block new enables if any test or canary finds:

- Plaintext in a protected field, search index, log, export, or storage object.
- A legacy client that can write plaintext.
- Recovery that fails on a fresh device.
- Ciphertext corruption shown as valid empty content.
- A share link that reads data after sealing starts.
- Current data left on an old key epoch after rotation.

## Closed implementation decisions

- New wrappers use the Argon2id parameters above; bounded scrypt remains read-compatible.
- Browser custody uses a non-extractable IndexedDB wrapping key, desktop uses Electron `safeStorage`, and CLI uses the platform credential store. Unavailable secure storage means session-only unlock.
- Convex `v.bytes()` carries envelope and grant bytes; CLI HTTP uses strict canonical base64 at the boundary.
- The server caps an encrypted field at 768 KiB and sealing initially batches at 20 records or 512 KiB.
- Team grants use the pinned RFC 9180 HPKE packages with X25519, HKDF-SHA-256, and ChaCha20-Poly1305. Browser, Bun, and desktop builds share the same vectors.
