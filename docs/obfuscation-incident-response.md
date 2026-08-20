# Obfuscation incident response

## Rollout controls

`OBFUSCATION_ROLLOUT` gates only new owner setup. It accepts `all` or a comma-separated list of workspace owner IDs and defaults to off. `OBFUSCATION_TEAM_ROLLOUT` independently gates new encrypted team invitations and also defaults to off. Disabling either flag must not block unlock, reads, recovery, account deletion, an already-pending approval, or rotation for an existing encrypted workspace.

Roll out in this order:

1. Synthetic workspace: setup, seal, lock, recovery unlock, export, and account deletion.
2. Internal owner-only workspace.
3. Allowlisted owner workspaces.
4. Synthetic and internal team enrollment, removal, and interrupted rotation.
5. Allowlisted team workspaces, then `all` only after the same deployment passes native checks.

After the first workspace begins sealing, every deployment and rollback target must understand crypto protocol 1. Never deploy an older server or client as a rollback.

## Stop conditions

Immediately stop new setup and new team invitations for any ciphertext corruption, plaintext residue, obsolete-client write bypass, recovery failure, grant substitution, or cross-workspace authorization issue. Do not turn off encrypted reads for existing workspaces.

The workspace state and operation contain only safe operational details: state, phase, processed count, timestamps, lease IDs, and a sanitized error category. Do not log content, envelopes, opaque tokens, passphrases, recovery material, keys, invite fragments, decrypted errors, or exported filenames.

## Failure playbooks

- **Wrong passphrase or kit:** fail locally. Do not mutate workspace state or upload diagnostics containing the input.
- **Closed client or lost lease:** wait for lease expiry, unlock on an owner client, and resume. A second client must not steal a live lease.
- **Corrupt ciphertext:** preserve the ciphertext, stop the batch, and keep the workspace in `failed`. Use **Download encrypted backup** while locked before attempting repair. Create a local readable export only when decryption still succeeds and the owner explicitly requests one.
- **Audit residue:** keep the workspace in `failed`; use the reported table and category to repair the client migration, then resume audit. Do not mark it sealed manually.
- **Interrupted rotation:** new writes remain on the new epoch. Resume with the owner passphrase so both old and new keys are available. Delete old grants only after the final audit passes.
- **Lost owner credentials:** Agendex cannot recover the data. Account deletion must still delete ciphertext and encrypted blobs without unlock.
- **Suspected key exposure:** rotate by removing the affected member. If the owner key or recovery kit is exposed and no member can be removed to initiate rotation safely, stop access and escalate; there is no plaintext rollback.

For support, record only workspace ID, crypto protocol, state, phase, key epoch number, processed count, timestamps, and sanitized violation category.
