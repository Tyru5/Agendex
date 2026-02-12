import { useEffect, useMemo, useState } from 'react';
import { hasToken, setToken, type Plan } from './lib/api.ts';
import { usePlans, useAgents } from './hooks/usePlans.ts';
import { SearchBar } from './components/SearchBar.tsx';
import { AgentFilter } from './components/AgentFilter.tsx';
import { PlanList } from './components/PlanList.tsx';
import { PlanViewer } from './components/PlanViewer.tsx';
import { PlanEditor } from './components/PlanEditor.tsx';

function Login() {
  const [token, setTokenValue] = useState('');

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (token.trim()) {
      setToken(token.trim());
      window.location.reload();
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <form onSubmit={submit} className="w-80 space-y-4">
        <h1 className="text-2xl font-bold text-center">planfig</h1>
        <p className="text-sm text-gray-500 text-center">Enter your auth token</p>
        <input
          type="password"
          value={token}
          onChange={(e) => setTokenValue(e.target.value)}
          placeholder="Token"
          className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          autoFocus
        />
        <button
          type="submit"
          className="w-full px-3 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700"
        >
          Connect
        </button>
      </form>
    </div>
  );
}

function Dashboard() {
  const [search, setSearch] = useState('');
  const [agentFilter, setAgentFilter] = useState<string | undefined>();
  const [selectedPlan, setSelectedPlan] = useState<Plan | undefined>();
  const [editing, setEditing] = useState(false);

  const filters = useMemo(
    () => ({ agent: agentFilter, q: search || undefined }),
    [agentFilter, search],
  );

  const { plans, loading, error, refresh } = usePlans(filters);
  const agents = useAgents();

  useEffect(() => {
    if (plans.length === 0) {
      setSelectedPlan(undefined);
      setEditing(false);
      return;
    }

    setSelectedPlan((current) => {
      if (!current) return plans[0];
      return plans.find((plan) => plan.id === current.id) ?? plans[0];
    });
  }, [plans]);

  function handleSaved() {
    setEditing(false);
    refresh();
  }

  return (
    <div className="h-screen flex">
      {/* Sidebar */}
      <div className="w-72 border-r border-gray-200 dark:border-zinc-800 flex flex-col shrink-0">
        <div className="p-4 border-b border-gray-200 dark:border-zinc-800">
          <h1 className="text-lg font-bold mb-3">planfig</h1>
          <SearchBar onSearch={setSearch} />
        </div>
        <div className="p-3 border-b border-gray-200 dark:border-zinc-800">
          <AgentFilter agents={agents} selected={agentFilter} onSelect={setAgentFilter} />
        </div>
        <div className="flex-1 overflow-auto p-2">
          {loading ? (
            <div className="p-4 text-sm text-gray-500">Loading plans...</div>
          ) : error ? (
            <div className="p-4 text-sm text-red-600 dark:text-red-400">
              Failed to load plans ({error}). Verify the server is running and the auth token is
              valid.
            </div>
          ) : (
            <PlanList plans={plans} selectedId={selectedPlan?.id} onSelect={setSelectedPlan} />
          )}
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 min-w-0">
        {selectedPlan ? (
          editing ? (
            <PlanEditor
              plan={selectedPlan}
              onClose={() => setEditing(false)}
              onSaved={handleSaved}
            />
          ) : (
            <PlanViewer plan={selectedPlan} onEdit={() => setEditing(true)} />
          )
        ) : (
          <div className="h-full flex items-center justify-center text-gray-400 text-sm">
            Select a plan to view
          </div>
        )}
      </div>
    </div>
  );
}

export default function App() {
  if (!hasToken()) return <Login />;
  return <Dashboard />;
}
