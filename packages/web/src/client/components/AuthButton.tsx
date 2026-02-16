import { useAuth } from '../hooks/useAuth.ts';
import { Skeleton } from './Skeleton';

export function AuthButton() {
  const { user, isLoading, isAuthenticated, signIn, signOut } = useAuth();

  if (isLoading) {
    return <Skeleton width="72px" height="28px" borderRadius="6px" />;
  }

  if (!isAuthenticated) {
    return (
      <button
        type="button"
        onClick={() => signIn.social({ provider: 'github' })}
        style={{
          fontSize: '12px',
          padding: '4px 10px',
          borderRadius: '6px',
          border: '1px solid var(--border)',
          background: 'var(--surface)',
          color: 'var(--text)',
          cursor: 'pointer',
          fontWeight: 500,
        }}
      >
        Sign in
      </button>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <span
        style={{
          fontSize: '12px',
          color: 'var(--secondary)',
          fontWeight: 500,
          maxWidth: '120px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {user?.name || user?.email}
      </span>
      <button
        type="button"
        onClick={() => signOut()}
        style={{
          fontSize: '12px',
          padding: '4px 10px',
          borderRadius: '6px',
          border: '1px solid var(--border)',
          background: 'transparent',
          color: 'var(--tertiary)',
          cursor: 'pointer',
          fontWeight: 500,
        }}
      >
        Sign out
      </button>
    </div>
  );
}
