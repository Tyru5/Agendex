import { Skeleton } from '@agendex/web';
import { useAuth } from '../hooks/useAuth.ts';

export function AuthButton() {
  const { user, isLoading, isAuthenticated, signIn, signOut } = useAuth();

  if (isLoading) {
    return <Skeleton width="72px" height="28px" borderRadius="6px" />;
  }

  if (!isAuthenticated) {
    return (
      <button
        type="button"
        onClick={() => signIn.social({ provider: 'github', callbackURL: '/' })}
        className="text-[12px] px-2.5 py-1 rounded-[6px] border border-border bg-surface text-text cursor-pointer font-medium"
      >
        Sign in
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-[12px] text-secondary font-medium max-w-[120px] overflow-hidden text-ellipsis whitespace-nowrap">
        {user?.name || user?.email}
      </span>
      <button
        type="button"
        onClick={() => signOut()}
        className="text-[12px] px-2.5 py-1 rounded-[6px] border border-border bg-transparent text-tertiary cursor-pointer font-medium"
      >
        Sign out
      </button>
    </div>
  );
}
