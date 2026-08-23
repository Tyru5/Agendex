import {
  branchUrl,
  commitUrl,
  extractPlanGitContext,
  planGitLinkUrl,
  shortCommit,
  normalizePlanGitLink,
} from '@agendex/shared/git-forge';
import { decryptWorkspaceValue, encryptWorkspaceValue } from '@agendex/shared/crypto';
import { PlanGitSection, type PlanGitChip } from '@agendex/web';
import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useMutation, useQuery } from 'convex/react';
import { ConvexError } from 'convex/values';
import { useMemo } from 'react';
import { useWorkspaceCryptoStatus } from '../hooks/useCloudMetadataCrypto.ts';
import { withWorkspaceKey } from '../lib/obfuscation-keyring.ts';

function errorMessage(err: unknown): string {
  if (err instanceof ConvexError) {
    if (typeof err.data === 'string') return err.data;
    if (
      err.data != null &&
      typeof err.data === 'object' &&
      'message' in err.data &&
      typeof (err.data as { message: unknown }).message === 'string'
    ) {
      return (err.data as { message: string }).message;
    }
  }
  return err instanceof Error ? err.message : 'Something went wrong';
}

export function buildDetectedGitChips(metadata: unknown): PlanGitChip[] {
  const context = extractPlanGitContext(metadata);
  if (!context) return [];

  const chips: PlanGitChip[] = [];
  if (context.repo) {
    chips.push({
      key: 'detected-repo',
      kind: 'repo',
      label: `${context.repo.owner}/${context.repo.name}`,
      url: context.repo.webUrl,
      title: 'Repository detected from the synced workspace',
      detected: true,
    });
  }
  if (context.branch) {
    chips.push({
      key: 'detected-branch',
      kind: 'branch',
      label: context.branch,
      url: branchUrl(context.repo, context.branch),
      title: 'Branch detected from the synced workspace',
      detected: true,
    });
  }
  if (context.commit) {
    chips.push({
      key: 'detected-commit',
      kind: 'commit',
      label: shortCommit(context.commit),
      url: commitUrl(context.repo, context.commit),
      title: `Commit ${context.commit} detected from the synced workspace`,
      detected: true,
    });
  }
  return chips;
}

/**
 * Git/PR linkage for cloud plans (Pro): detected workspace context from
 * `metadata.git` plus manually linked branches/commits/PRs stored in Convex.
 */
export function CloudPlanGitLinks({ planId, metadata }: { planId: string; metadata: unknown }) {
  const links = useQuery(api.planLinks.getLinks, { planId: planId as Id<'plans'> });
  const cryptoStatus = useWorkspaceCryptoStatus();
  const addLink = useMutation(api.planLinks.addLink);
  const deleteLink = useMutation(api.planLinks.deleteLink);

  const repo = useMemo(() => extractPlanGitContext(metadata)?.repo, [metadata]);
  const detectedChips = useMemo(() => buildDetectedGitChips(metadata), [metadata]);

  const readableLinks = useMemo(
    () =>
      (links ?? []).map((link) => {
        if (
          !link.encryptedLink ||
          !link.stableCryptoId ||
          !link.keyEpoch ||
          !cryptoStatus?.workspaceOwnerId
        ) {
          return link;
        }
        const keyEpoch = link.keyEpoch;
        const stableCryptoId = link.stableCryptoId;
        try {
          const value = withWorkspaceKey(cryptoStatus.workspaceOwnerId, (workspaceKey) =>
            decryptWorkspaceValue<{ value: string; url?: string }>({
              workspaceKey,
              workspaceOwnerId: cryptoStatus.workspaceOwnerId,
              keyEpoch,
              table: 'planLinks',
              slot: 'link',
              stableCryptoId,
              envelope: link.encryptedLink,
            }),
          );
          return { ...link, ...value };
        } catch {
          return { ...link, value: 'Locked link', url: undefined };
        }
      }),
    [cryptoStatus, links],
  );

  const linkChips: PlanGitChip[] = readableLinks.map((link) => ({
    key: link._id,
    kind: link.type,
    label: link.type === 'commit' ? shortCommit(link.value) : link.value,
    url: planGitLinkUrl(link, repo),
    title: link.type === 'commit' ? link.value : undefined,
    onRemove: () => {
      void deleteLink({ linkId: link._id }).catch(() => {
        // Row stays visible via the reactive query when deletion fails.
      });
    },
  }));

  const handleAddLink = async (input: string): Promise<string | null> => {
    try {
      if (cryptoStatus?.settings) {
        const settings = cryptoStatus.settings;
        const normalized = normalizePlanGitLink(input, repo);
        if (!normalized.ok) return normalized.error;
        const encrypted = withWorkspaceKey(cryptoStatus.workspaceOwnerId, (workspaceKey) =>
          encryptWorkspaceValue({
            workspaceKey,
            workspaceOwnerId: cryptoStatus.workspaceOwnerId,
            keyEpoch: settings.activeKeyEpoch,
            table: 'planLinks',
            slot: 'link',
            value: { value: normalized.link.value, url: normalized.link.url },
          }),
        );
        await addLink({
          planId: planId as Id<'plans'>,
          input: '',
          type: normalized.link.type,
          clientCryptoProtocol: 1,
          stableCryptoId: encrypted.stableCryptoId,
          keyEpoch: encrypted.keyEpoch,
          encryptedLink: encrypted.envelope,
        });
      } else {
        await addLink({ planId: planId as Id<'plans'>, input });
      }
      return null;
    } catch (err) {
      return errorMessage(err);
    }
  };

  return <PlanGitSection chips={[...detectedChips, ...linkChips]} onAddLink={handleAddLink} />;
}
