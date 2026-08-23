import {
  generateStableCryptoId,
  openBytes,
  packEncryptedBlob,
  sealBytes,
  unpackEncryptedBlob,
} from '@agendex/shared/crypto';
import { api } from '@convex/_generated/api';
import { useQuery } from 'convex/react';
import { useEffect, useState } from 'react';
import { withWorkspaceKey } from '../lib/obfuscation-keyring.ts';
import { useWorkspaceCryptoStatus } from './useCloudMetadataCrypto.ts';

export async function encryptAgentAvatar(args: {
  file: File;
  workspaceOwnerId: string;
  keyEpoch: number;
}) {
  const stableCryptoId = generateStableCryptoId();
  const plaintext = new Uint8Array(await args.file.arrayBuffer());
  const packed = withWorkspaceKey(args.workspaceOwnerId, (_workspaceKey, derivedKeys) =>
    packEncryptedBlob(
      sealBytes(derivedKeys.contentKey, plaintext, {
        workspaceOwnerId: args.workspaceOwnerId,
        table: 'agentAvatars',
        stableCryptoId,
        slot: 'avatar',
        keyEpoch: args.keyEpoch,
      }),
    ),
  );
  plaintext.fill(0);
  return {
    body: new Blob([packed.slice().buffer as ArrayBuffer], { type: 'application/octet-stream' }),
    stableCryptoId,
    keyEpoch: args.keyEpoch,
  };
}

export function useAgentAvatars(enabled = true) {
  const rows = useQuery(api.agentAvatars.listMyAgentAvatarRecords, enabled ? {} : 'skip');
  const status = useWorkspaceCryptoStatus(enabled);
  const [avatars, setAvatars] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!rows) return;
    let cancelled = false;
    const objectUrls: string[] = [];
    void Promise.all(
      rows.map(async (row) => {
        if (!row.url) return [row.agent, ''] as const;
        if (!row.encrypted || !row.stableCryptoId || !row.keyEpoch || !status?.workspaceOwnerId) {
          return [row.agent, row.url] as const;
        }
        const { stableCryptoId, keyEpoch } = row;
        const workspaceOwnerId = status.workspaceOwnerId;
        try {
          const response = await fetch(row.url);
          if (!response.ok) throw new Error('Unable to load encrypted avatar');
          const packed = new Uint8Array(await response.arrayBuffer());
          const bytes = withWorkspaceKey(workspaceOwnerId, (_workspaceKey, derivedKeys) =>
            openBytes(derivedKeys.contentKey, unpackEncryptedBlob(packed), {
              workspaceOwnerId,
              table: 'agentAvatars',
              stableCryptoId,
              slot: 'avatar',
              keyEpoch,
            }),
          );
          const url = URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer]));
          bytes.fill(0);
          objectUrls.push(url);
          return [row.agent, url] as const;
        } catch {
          return [row.agent, ''] as const;
        }
      }),
    ).then((entries) => {
      if (!cancelled) setAvatars(Object.fromEntries(entries.filter(([, url]) => url)));
    });
    return () => {
      cancelled = true;
      for (const url of objectUrls) URL.revokeObjectURL(url);
    };
  }, [rows, status]);

  return avatars;
}
