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
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: 'var(--bg)' }}
    >
      <form onSubmit={submit} className="w-72 space-y-3">
        <h1
          className="text-center font-semibold tracking-tight"
          style={{ fontSize: '14px', color: 'var(--text)' }}
        >
          planfig
        </h1>
        <p className="text-center" style={{ fontSize: '12.5px', color: 'var(--tertiary)' }}>
          Enter your auth token
        </p>
        <input
          type="password"
          value={token}
          onChange={(e) => setTokenValue(e.target.value)}
          placeholder="Token"
          className="w-full px-3 py-2 rounded-lg text-sm outline-none"
          style={{
            background: 'transparent',
            border: '1px solid var(--border)',
            color: 'var(--text)',
            fontSize: '13px',
          }}
          autoFocus
        />
        <button
          type="submit"
          className="w-full px-3 py-2 text-sm rounded-lg font-medium transition-colors"
          style={{
            background: 'var(--text)',
            color: 'var(--bg)',
            fontSize: '13px',
          }}
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

  const totalPlans = useMemo(() => agents.reduce((sum, a) => sum + a.planCount, 0), [agents]);

  const activeAgents = useMemo(() => agents.filter((a) => a.planCount > 0).length, [agents]);

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
    <div
      className="h-screen grid overflow-hidden"
      style={{
        gridTemplateColumns: '260px 1fr',
        gridTemplateRows: '53px 1fr',
      }}
    >
      {/* Topbar */}
      <div
        className="flex items-center px-5 gap-4"
        style={{
          gridColumn: '1 / -1',
          borderBottom: '1px solid var(--border)',
          background: 'var(--surface)',
          zIndex: 50,
        }}
      >
        <span
          className="font-semibold text-sm"
          style={{ letterSpacing: '-0.02em', color: 'var(--text)' }}
        >
          planfig
        </span>
        <div style={{ width: '1px', height: '18px', background: 'var(--border)' }} />
        <SearchBar onSearch={setSearch} />
        <div className="flex-1" />
        <span style={{ fontSize: '12px', color: 'var(--tertiary)' }}>
          <strong style={{ color: 'var(--secondary)', fontWeight: 550 }}>{totalPlans}</strong> plans
        </span>
        <div style={{ width: '1px', height: '18px', background: 'var(--border)' }} />
        <span style={{ fontSize: '12px', color: 'var(--tertiary)' }}>
          <strong style={{ color: 'var(--secondary)', fontWeight: 550 }}>{activeAgents}</strong>{' '}
          agents
        </span>
        <div style={{ width: '1px', height: '18px', background: 'var(--border)' }} />
        <div className="flex items-center gap-1.5">
          <div
            className="rounded-full"
            style={{
              width: '6px',
              height: '6px',
              background: '#22c55e',
              boxShadow: '0 0 0 2px var(--surface)',
            }}
          />
          <span style={{ fontSize: '12px', color: 'var(--tertiary)' }}>Live</span>
        </div>
      </div>

      {/* Sidebar */}
      <div
        className="flex flex-col overflow-hidden"
        style={{
          borderRight: '1px solid var(--border)',
          background: 'var(--surface)',
        }}
      >
        <div className="p-3">
          <AgentFilter agents={agents} selected={agentFilter} onSelect={setAgentFilter} />
        </div>

        <div className="px-3">
          <div
            style={{
              fontSize: '11px',
              fontWeight: 550,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: 'var(--tertiary)',
              padding: '0 8px',
              marginBottom: '4px',
            }}
          >
            Recent
          </div>
        </div>

        <div className="flex-1 overflow-auto px-3 pb-3 sidebar-scroll">
          {loading ? (
            <div className="p-4" style={{ fontSize: '13px', color: 'var(--tertiary)' }}>
              Loading...
            </div>
          ) : error ? (
            <div className="p-4" style={{ fontSize: '13px', color: '#ef4444' }}>
              Failed to load plans.
            </div>
          ) : (
            <PlanList plans={plans} selectedId={selectedPlan?.id} onSelect={setSelectedPlan} />
          )}
        </div>
      </div>

      {/* Main */}
      <div className="overflow-auto main-scroll" style={{ background: 'var(--bg)' }}>
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
          <div
            className="h-full flex items-center justify-center"
            style={{ fontSize: '13px', color: 'var(--tertiary)' }}
          >
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
