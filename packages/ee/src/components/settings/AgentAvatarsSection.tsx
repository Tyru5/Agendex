import { AGENT_IDS, AgentIcon, getAgentLabel } from '@agendex/web';
import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useMutation, useQuery } from 'convex/react';
import { useMemo, useRef, useState } from 'react';

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_BYTES = 2 * 1024 * 1024;

function buildAgentList(): Array<{ agent: string; label: string }> {
  const items = AGENT_IDS.map((agent) => ({
    agent: agent.trim().toLowerCase(),
    label: getAgentLabel(agent),
  }));
  return items.sort((a, b) => a.label.localeCompare(b.label));
}

function AgentAvatarRow({
  agent,
  label,
  avatarUrl,
  busy,
  errorMessage,
  onPickFile,
  onRemove,
}: {
  agent: string;
  label: string;
  avatarUrl: string | undefined;
  busy: boolean;
  errorMessage: string | undefined;
  onPickFile: (file: File) => void;
  onRemove: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const hasCustom = Boolean(avatarUrl);

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3">
      <AgentIcon agent={agent} size={40} avatarUrl={avatarUrl} />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-text truncate">{label}</div>
        <div className="text-[11px] text-secondary truncate">
          {hasCustom ? 'Custom avatar' : 'Default branding'}
        </div>
        {errorMessage && (
          <div className="text-[11px] text-red-400 mt-1 truncate" role="alert">
            {errorMessage}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onPickFile(file);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="text-[12px] px-2.5 py-1.5 rounded-lg border border-border bg-transparent text-text cursor-pointer font-medium transition-colors duration-150 hover:bg-hover disabled:opacity-50 disabled:cursor-default"
        >
          {busy ? 'Uploading…' : hasCustom ? 'Replace' : 'Upload'}
        </button>
        {hasCustom && (
          <button
            type="button"
            disabled={busy}
            onClick={onRemove}
            className="text-[12px] px-2.5 py-1.5 rounded-lg border border-border bg-transparent text-secondary cursor-pointer font-medium transition-colors duration-150 hover:text-red-400 hover:border-red-400/30 hover:bg-red-400/10 disabled:opacity-50 disabled:cursor-default"
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

export function AgentAvatarsSection() {
  const avatars = useQuery(api.agentAvatars.listMyAgentAvatars);
  const generateUploadUrl = useMutation(api.agentAvatars.generateAgentAvatarUploadUrl);
  const setAgentAvatar = useMutation(api.agentAvatars.setAgentAvatar);
  const removeAgentAvatar = useMutation(api.agentAvatars.removeAgentAvatar);

  const [busyAgent, setBusyAgent] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const allAgents = useMemo(() => {
    const items = buildAgentList();
    if (avatars) {
      const known = new Set(items.map((i) => i.agent));
      for (const agent of Object.keys(avatars)) {
        if (!known.has(agent)) {
          items.push({ agent, label: getAgentLabel(agent) });
        }
      }
    }
    return items;
  }, [avatars]);

  function setError(agent: string, message: string | undefined) {
    setErrors((prev) => {
      const next = { ...prev };
      if (message) next[agent] = message;
      else delete next[agent];
      return next;
    });
  }

  async function handleUpload(agent: string, file: File) {
    setError(agent, undefined);
    if (!ALLOWED_TYPES.has(file.type)) {
      setError(agent, 'Use JPEG, PNG, WebP, or GIF.');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(agent, 'Image must be under 2MB.');
      return;
    }

    setBusyAgent(agent);
    try {
      const { uploadUrl, reservationId } = await generateUploadUrl({ agent });
      const uploadRes = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (!uploadRes.ok) {
        throw new Error(`Upload failed (${uploadRes.status})`);
      }
      const { storageId } = (await uploadRes.json()) as { storageId: Id<'_storage'> };
      await setAgentAvatar({ agent, storageId, reservationId });
    } catch (err) {
      console.error('Avatar upload failed', err);
      setError(agent, err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusyAgent(null);
    }
  }

  async function handleRemove(agent: string) {
    setError(agent, undefined);
    setBusyAgent(agent);
    try {
      await removeAgentAvatar({ agent });
    } catch (err) {
      console.error('Avatar removal failed', err);
      setError(agent, err instanceof Error ? err.message : 'Removal failed');
    } finally {
      setBusyAgent(null);
    }
  }

  return (
    <section>
      <h2 className="text-[20px] font-semibold text-text mb-2">Agent Avatars</h2>
      <p className="text-[13px] text-secondary mb-4">
        Upload custom avatars to override the default branding for any agent. Your avatars are used
        everywhere the agent appears in the dashboard. Max 2MB. JPEG, PNG, WebP, or GIF.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {allAgents.map(({ agent, label }) => (
          <AgentAvatarRow
            key={agent}
            agent={agent}
            label={label}
            avatarUrl={avatars?.[agent]}
            busy={busyAgent === agent}
            errorMessage={errors[agent]}
            onPickFile={(file) => handleUpload(agent, file)}
            onRemove={() => handleRemove(agent)}
          />
        ))}
      </div>
    </section>
  );
}
