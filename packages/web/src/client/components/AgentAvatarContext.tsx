import { createContext, type ReactNode, useContext, useMemo } from 'react';

type AgentAvatarMap = Record<string, string>;

const AgentAvatarContext = createContext<AgentAvatarMap>({});

export function AgentAvatarProvider({
  avatars,
  children,
}: {
  avatars: AgentAvatarMap | undefined;
  children: ReactNode;
}) {
  const value = useMemo<AgentAvatarMap>(() => avatars ?? {}, [avatars]);
  return <AgentAvatarContext.Provider value={value}>{children}</AgentAvatarContext.Provider>;
}

export function useAgentAvatarUrl(agent: string): string | undefined {
  const map = useContext(AgentAvatarContext);
  return map[agent.trim().toLowerCase()];
}

export function useAgentAvatarMap(): AgentAvatarMap {
  return useContext(AgentAvatarContext);
}
