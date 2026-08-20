# Obfuscation

Obfuscation is Agendex Cloud Pro's irreversible zero-access encryption mode. Titles, plan bodies, paths, comments, annotations, links, tags, collections, history, writebacks, avatar files, and attachment files are encrypted on an authorized client before Convex receives them. Agendex and a database operator can see ciphertext and operational metadata, but cannot decrypt cloud content.

This is client-side envelope encryption, not zk-SNARK cryptography. It does not hide record counts, timestamps, agents, sizes, billing data, account email addresses, or access patterns. It also cannot protect an unlocked device, compromised client code, or data a member already copied.

## Before enabling

- Only the Cloud Pro workspace owner can enable Obfuscation.
- Setup is permanent. There is no disable operation or plaintext rollback.
- Setup creates a workspace passphrase and a recovery kit. Agendex cannot reset either one.
- Download and re-import the recovery kit before confirming setup. Keep it offline and separate from the device.
- Existing share links are revoked when sealing starts. New share links and cloud body search remain disabled.
- A readable export is created in the browser after unlock. Convex never creates a plaintext export for an obfuscated workspace. A separate encrypted backup remains available while locked and preserves ciphertext, wrapped-key metadata, and encrypted blobs.

The owner client seals existing records in resumable, leased batches. New writes switch to encrypted form at the first sealing transaction. Closing the tab is safe: the operation resumes after the lease expires. A final audit must find no plaintext or obsolete key epoch before the workspace becomes sealed.

## Unlock and recovery

The web app keeps the decrypted workspace key in memory and may protect it with a non-extractable browser key stored by IndexedDB. Desktop uses Electron `safeStorage`. The CLI uses the supported operating-system credential store. If secure storage is unavailable, unlock lasts only for the process or browser session. Raw keys and passphrases are never written to Agendex configuration files or local storage.

Use **Lock** in Account settings or `agendex lock` to remove the retained key. Use the recovery-kit picker in Account settings or:

```bash
agendex unlock --recovery /path/to/agendex-recovery.json
```

Recovery kits are secrets. Anyone who obtains a valid kit can decrypt the corresponding key epoch. A lost passphrase and lost recovery kit cannot be reproduced by Agendex.
An unlocked owner can download a fresh kit from Account settings. Earlier kits for that epoch remain valid until key rotation.

## Exports and encrypted backups

Both archive paths stream to a user-selected file or browser-private temporary storage instead of retaining the whole ZIP in memory. The readable export requires an unlocked workspace and contains decrypted content. The encrypted backup does not require a key; content remains ciphertext and Convex byte fields are encoded as canonical base64. Its account and service metadata remain plaintext. Signed storage URLs are removed and encrypted attachment and avatar bytes are copied into the archive.

## Members

Encrypted invites carry a random enrollment secret in the URL fragment (`#k=`). URL fragments are retained only in browser session state during OAuth and are not sent to Convex. A member creates an X25519 identity, protects the private key with a member passphrase and recovery kit, and sends the public key plus a proof bound to the invite, account, and public key. Membership remains pending until the owner verifies the proof locally and creates an RFC 9180 HPKE workspace-key grant.

Removing a member immediately deletes membership and revokes that member's grants. The owner creates a new workspace key epoch, grants it to every remaining member, and resumably re-encrypts all current content and files. The old key cannot revoke plaintext a former member already copied.

## Deliberate limitations

- Cloud title, agent, and tag filtering decrypts list data on the client. Cloud body search is disabled.
- Public share links are disabled; fragment-key share links are not implemented.
- Server-side LLM processing of encrypted content is impossible by design.
- Account identity, subscription, ownership, timestamps, agent, `lowValue`, client-computed content hashes, and other documented routing metadata remain plaintext.
- OSS local indexing is unchanged.

See [Obfuscation incident response](./obfuscation-incident-response.md) for rollout and failure procedures.
