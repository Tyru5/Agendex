import type { Plan } from '@agendex/web';
import { decryptPlanBody } from '@agendex/shared/crypto';
import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useQuery } from 'convex/react';
import { useEffect, useState } from 'react';
import { useCloudPlanEdits } from '../hooks/useCloudPlanEdits';
import { useWorkspaceCryptoStatus } from '../hooks/useCloudMetadataCrypto';
import { withWorkspaceKey } from '../lib/obfuscation-keyring';

export function CloudPlanEditor({
  plan,
  onClose,
  onSaved,
}: {
  plan: Plan;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { updateContent } = useCloudPlanEdits();
  const cryptoStatus = useWorkspaceCryptoStatus();
  const encryptedPlan = useQuery(
    api.plans.getPlan,
    cryptoStatus?.settings ? { planId: plan.id as Id<'plans'> } : 'skip',
  );
  const [content, setContent] = useState('');
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    setReady(false);
    setError(undefined);
    if (!cryptoStatus) {
      setContent('');
      return;
    }
    if (!cryptoStatus.settings) {
      setContent(plan.content);
      setReady(true);
      return;
    }
    try {
      if (!encryptedPlan) {
        setContent('');
        return;
      }
      const { stableCryptoId, keyEpoch, encryptedBody } = encryptedPlan;
      if (!stableCryptoId || !keyEpoch || !encryptedBody) {
        throw new Error('Encrypted plan content is unavailable');
      }
      const plaintext = withWorkspaceKey(
        cryptoStatus.workspaceOwnerId,
        (workspaceKey) =>
          decryptPlanBody({
            workspaceKey,
            workspaceOwnerId: cryptoStatus.workspaceOwnerId,
            stableCryptoId,
            keyEpoch,
            envelope: encryptedBody,
          }),
        keyEpoch,
      );
      setContent(plaintext);
      setReady(true);
    } catch (e) {
      setContent('');
      setError(e instanceof Error ? e.message : 'Unable to decrypt this plan');
    }
  }, [plan.id, plan.content, cryptoStatus, encryptedPlan]);

  async function save() {
    if (!ready) return;
    setSaving(true);
    setError(undefined);
    try {
      await updateContent(plan.id as Id<'plans'>, plan.title, content);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-6 py-3 border-b border-border">
        <div>
          <h1 className="text-[14px] font-semibold text-text">Editing: {plan.title}</h1>
          <p className="text-[11.5px] text-tertiary mt-0.5 font-[var(--font-mono,monospace)]">
            Cloud plan
          </p>
        </div>
        <div className="flex items-center gap-2">
          {error && <span className="text-xs text-[var(--danger)]">{error}</span>}
          <button
            type="button"
            onClick={onClose}
            className="py-[5px] px-3 text-[12.5px] font-medium font-[inherit] rounded-[7px] border border-border bg-transparent text-secondary cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || !ready}
            className="py-[5px] px-3 text-[12.5px] font-medium font-[inherit] rounded-[7px] border-0 bg-text text-bg"
            style={{
              cursor: saving || !ready ? 'default' : 'pointer',
              opacity: saving || !ready ? 0.5 : 1,
            }}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
      <div className="flex-1 p-4">
        <textarea
          value={content}
          disabled={!ready}
          onChange={(e) => setContent(e.target.value)}
          className="h-full w-full resize-none rounded-[10px] border border-border bg-surface px-4 py-3 text-[13px] leading-6 text-text outline-none"
        />
      </div>
    </div>
  );
}
