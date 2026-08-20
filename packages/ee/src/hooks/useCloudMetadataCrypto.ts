import {
  computeOpaqueToken,
  decryptWorkspaceValue,
  encryptWorkspaceValue,
} from '@agendex/shared/crypto';
import { api } from '@convex/_generated/api';
import type { Doc, Id } from '@convex/_generated/dataModel';
import { useQuery } from 'convex/react';
import { useMemo, useSyncExternalStore } from 'react';
import {
  getWorkspaceKeyringSnapshot,
  subscribeWorkspaceKeyring,
  withWorkspaceKey,
} from '../lib/obfuscation-keyring';

type CryptoStatus = Exclude<
  ReturnType<typeof useQuery<typeof api.workspaceCrypto.getWorkspaceCryptoStatus>>,
  undefined
>;

function isEncrypted(status: CryptoStatus | null | undefined): boolean {
  return Boolean(status?.settings && status.settings.state !== 'disabled');
}

function useCryptoStatus(enabled = true) {
  const status = useQuery(api.workspaceCrypto.getWorkspaceCryptoStatus, enabled ? {} : 'skip');
  const workspaceOwnerId = status?.workspaceOwnerId ?? '';
  useSyncExternalStore(
    subscribeWorkspaceKeyring,
    () => getWorkspaceKeyringSnapshot(workspaceOwnerId, status?.settings?.activeKeyEpoch ?? null),
    () => getWorkspaceKeyringSnapshot(workspaceOwnerId, status?.settings?.activeKeyEpoch ?? null),
  );
  return status;
}

function decryptTag(tag: Doc<'tags'>, status: CryptoStatus | null | undefined): Doc<'tags'> {
  if (!tag.encryptedName || !tag.stableCryptoId || !tag.keyEpoch || !status?.workspaceOwnerId) {
    return tag;
  }
  const { encryptedName, stableCryptoId, keyEpoch } = tag;
  const workspaceOwnerId = status.workspaceOwnerId;
  try {
    const value = withWorkspaceKey(workspaceOwnerId, (workspaceKey) =>
      decryptWorkspaceValue<{ name: string }>({
        workspaceKey,
        workspaceOwnerId,
        keyEpoch,
        table: 'tags',
        slot: 'name',
        stableCryptoId,
        envelope: encryptedName,
      }),
    );
    return { ...tag, name: value.name, nameLc: value.name.toLowerCase() };
  } catch {
    return { ...tag, name: 'Locked tag', nameLc: '' };
  }
}

function decryptCollection(
  collection: Doc<'collections'>,
  status: CryptoStatus | null | undefined,
): Doc<'collections'> {
  if (
    !collection.encryptedName ||
    !collection.stableCryptoId ||
    !collection.keyEpoch ||
    !status?.workspaceOwnerId
  ) {
    return collection;
  }
  const { encryptedName, encryptedDescription, stableCryptoId, keyEpoch } = collection;
  const workspaceOwnerId = status.workspaceOwnerId;
  try {
    return withWorkspaceKey(workspaceOwnerId, (workspaceKey) => {
      const name = decryptWorkspaceValue<{ name: string }>({
        workspaceKey,
        workspaceOwnerId,
        keyEpoch,
        table: 'collections',
        slot: 'name',
        stableCryptoId,
        envelope: encryptedName,
      }).name;
      const description = encryptedDescription
        ? decryptWorkspaceValue<{ description?: string }>({
            workspaceKey,
            workspaceOwnerId,
            keyEpoch,
            table: 'collections',
            slot: 'description',
            stableCryptoId,
            envelope: encryptedDescription,
          }).description
        : undefined;
      return { ...collection, name, nameLc: name.toLowerCase(), description };
    });
  } catch {
    return { ...collection, name: 'Locked collection', nameLc: '', description: undefined };
  }
}

export function buildTagWrite(
  status: CryptoStatus | null | undefined,
  name: string,
  stableCryptoId?: string,
) {
  if (!isEncrypted(status)) return { name };
  if (!status?.workspaceOwnerId || !status.settings)
    throw new Error('Obfuscation status unavailable');
  const { workspaceOwnerId, settings } = status;
  return withWorkspaceKey(workspaceOwnerId, (workspaceKey, derivedKeys) => {
    const encrypted = encryptWorkspaceValue({
      workspaceKey,
      workspaceOwnerId,
      keyEpoch: settings.activeKeyEpoch,
      table: 'tags',
      slot: 'name',
      stableCryptoId,
      value: { name },
    });
    return {
      name: '',
      clientCryptoProtocol: 1 as const,
      stableCryptoId: encrypted.stableCryptoId,
      keyEpoch: encrypted.keyEpoch,
      encryptedName: encrypted.envelope,
      nameToken: computeOpaqueToken(derivedKeys.indexKey, 'tag-name', [name]),
    };
  });
}

export function buildCollectionWrite(
  status: CryptoStatus | null | undefined,
  name: string,
  description?: string,
  stableCryptoId?: string,
) {
  if (!isEncrypted(status)) return { name, ...(description !== undefined ? { description } : {}) };
  if (!status?.workspaceOwnerId || !status.settings)
    throw new Error('Obfuscation status unavailable');
  const { workspaceOwnerId, settings } = status;
  return withWorkspaceKey(workspaceOwnerId, (workspaceKey, derivedKeys) => {
    const encryptedName = encryptWorkspaceValue({
      workspaceKey,
      workspaceOwnerId,
      keyEpoch: settings.activeKeyEpoch,
      table: 'collections',
      slot: 'name',
      stableCryptoId,
      value: { name },
    });
    const encryptedDescription = description
      ? encryptWorkspaceValue({
          workspaceKey,
          workspaceOwnerId,
          keyEpoch: settings.activeKeyEpoch,
          table: 'collections',
          slot: 'description',
          stableCryptoId: encryptedName.stableCryptoId,
          value: { description },
        }).envelope
      : undefined;
    return {
      name: '',
      clientCryptoProtocol: 1 as const,
      stableCryptoId: encryptedName.stableCryptoId,
      keyEpoch: encryptedName.keyEpoch,
      encryptedName: encryptedName.envelope,
      encryptedDescription,
      nameToken: computeOpaqueToken(derivedKeys.indexKey, 'collection-name', [name]),
    };
  });
}

export function useCloudTags(enabled = true) {
  const rows = useQuery(api.tags.listMyTags, enabled ? {} : 'skip');
  const status = useCryptoStatus(enabled);
  return useMemo(() => rows?.map((row) => decryptTag(row, status)), [rows, status]);
}

export function useCloudCollections(enabled = true) {
  const rows = useQuery(api.collections.listMyCollections, enabled ? {} : 'skip');
  const status = useCryptoStatus(enabled);
  return useMemo(() => rows?.map((row) => decryptCollection(row, status)), [rows, status]);
}

export function useCloudPlanTags(
  planIds: Array<Id<'plans'>> | null,
): Record<string, Doc<'tags'>[]> | undefined {
  const rows = useQuery(api.planTags.getTagsForPlans, planIds ? { planIds } : 'skip');
  const status = useCryptoStatus(planIds !== null);
  return useMemo(() => {
    if (!rows) return rows;
    return Object.fromEntries(
      Object.entries(rows).map(([planId, tags]) => [
        planId,
        tags.map((tag) => decryptTag(tag, status)),
      ]),
    ) as Record<string, Doc<'tags'>[]>;
  }, [rows, status]);
}

export function useWorkspaceCryptoStatus(enabled = true) {
  return useCryptoStatus(enabled);
}
