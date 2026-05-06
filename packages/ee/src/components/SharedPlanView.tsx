import {
  AgentIcon,
  buildPlanOutline,
  ExitFullscreenIcon,
  FullscreenIcon,
  getAgentLabel,
  MarkdownCodeBlock,
  PlanOutline,
  SkeletonBlock,
  sanitizeSchema,
  useFullscreen,
} from '@agendex/web';
import { api } from '@convex/_generated/api';
import { useAction, useQuery } from 'convex/react';
import { ConvexError } from 'convex/values';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useHotkey } from '@tanstack/react-hotkeys';
import Markdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import rehypeSlug from 'rehype-slug';
import remarkGfm from 'remark-gfm';
import { CommentThread } from './CommentThread.tsx';
import { OUTLINE_PREF_STORAGE_KEY } from '../outlinePref.ts';
import { CommandPalette } from './command-palette/CommandPalette.tsx';
import { useLocation } from 'wouter';

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins} minute${mins !== 1 ? 's' : ''} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs !== 1 ? 's' : ''} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days !== 1 ? 's' : ''} ago`;
}

type UnlockedPlan = {
  _id: string;
  agent: string;
  title: string;
  content: string;
  format: string;
  filePath?: string;
  createdAt: number;
};

function PasswordGate({
  token,
  onUnlock,
}: {
  token: string;
  onUnlock: (plan: UnlockedPlan) => void;
}) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const unlock = useAction(api.sharing.getSharedPlanWithPassword);

  useLayoutEffect(() => {
    passwordInputRef.current?.focus();
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!password) return;
      setSubmitting(true);
      setError('');
      try {
        const plan = await unlock({ token, password });
        onUnlock(plan as UnlockedPlan);
      } catch (err) {
        const message =
          err instanceof ConvexError
            ? typeof err.data === 'string'
              ? err.data
              : err.data != null &&
                  typeof err.data === 'object' &&
                  'message' in err.data &&
                  typeof (err.data as { message: unknown }).message === 'string'
                ? (err.data as { message: string }).message
                : 'Something went wrong'
            : err instanceof Error
              ? err.message
              : 'Incorrect password';
        setError(message.includes('Incorrect password') ? 'Incorrect password' : message);
      } finally {
        setSubmitting(false);
      }
    },
    [token, password, unlock, onUnlock],
  );

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg p-4">
      <div className="share-surface-in w-full max-w-[400px] rounded-2xl border border-border bg-surface px-8 py-9 shadow-[0_16px_40px_-16px_rgba(0,0,0,0.25)]">
        <div className="mb-7 text-left">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--text)_8%,transparent)] mb-4">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="h-[18px] w-[18px] text-text"
              aria-hidden
            >
              <title>Locked</title>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z"
              />
            </svg>
          </div>
          <h1 className="text-[17px] font-semibold text-text tracking-[0] mb-2">
            Password required
          </h1>
          <p className="text-[13px] text-tertiary leading-[1.5]">
            This plan was shared with a link password. Enter it to view the plan.
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <label htmlFor="shared-plan-password" className="sr-only">
            Password
          </label>
          <input
            ref={passwordInputRef}
            id="shared-plan-password"
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (error) setError('');
            }}
            placeholder="Password"
            autoComplete="current-password"
            className={`w-full py-2.5 px-3.5 text-[13px] font-[inherit] rounded-xl border bg-bg text-text outline-none placeholder:text-tertiary mb-2 transition-colors ${
              error ? 'border-[#ef4444]' : 'border-border focus:border-text'
            }`}
          />
          {error && (
            <p
              className="share-reveal text-[12px] text-[#ef4444] mb-3 [--share-delay:0ms]"
              role="alert"
            >
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={submitting || password.length === 0}
            className="w-full select-none py-2.5 px-4 text-[13px] font-semibold font-[inherit] rounded-xl border-none bg-text text-bg transition-[transform,opacity] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 cursor-pointer"
          >
            {submitting ? 'Verifying…' : 'Unlock'}
          </button>
        </form>
      </div>
    </div>
  );
}

export function SharedPlanView({ token }: { token: string }) {
  const queryResult = useQuery(api.plans.getPlanByShareToken, { token });
  const fullscreen = useFullscreen<HTMLDivElement>();
  const [, navigate] = useLocation();
  const [paletteSearch, setPaletteSearch] = useState('');
  const [unlockedPlan, setUnlockedPlan] = useState<UnlockedPlan | null>(null);
  const [outlineHidden, setOutlineHidden] = useState(() => {
    if (typeof window === 'undefined') return false;

    try {
      return localStorage.getItem(OUTLINE_PREF_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const toggleOutline = useCallback(() => setOutlineHidden((v) => !v), []);
  useHotkey('Mod+Shift+O', toggleOutline);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(OUTLINE_PREF_STORAGE_KEY, outlineHidden ? 'true' : 'false');
    } catch {
      // ignore
    }
  }, [outlineHidden]);

  // must reset when navigating to another shared link
  // oxlint-disable-next-line react/exhaustive-deps
  useEffect(() => {
    setUnlockedPlan(null);
  }, [token]);

  const needsPassword =
    queryResult && 'passwordRequired' in queryResult && queryResult.passwordRequired;

  const plan = needsPassword ? unlockedPlan : (queryResult as UnlockedPlan | null | undefined);

  const outline = useMemo(
    () =>
      plan
        ? buildPlanOutline({
            title: plan.title,
            content: plan.content,
            filePath: String(plan.filePath ?? ''),
            format: plan.format,
          })
        : null,
    [plan],
  );

  const sharedHome = useCallback(() => navigate('/'), [navigate]);

  let body: React.ReactNode;
  if (queryResult === undefined) {
    body = (
      <div className="min-h-screen flex items-center justify-center bg-bg">
        <div className="share-reveal w-full max-w-[600px] p-6 [--share-delay:0ms]">
          <SkeletonBlock lines={5} />
        </div>
      </div>
    );
  } else if (needsPassword && !unlockedPlan) {
    body = <PasswordGate token={token} onUnlock={setUnlockedPlan} />;
  } else if (!plan || !outline) {
    body = (
      <div className="min-h-screen flex items-center justify-center bg-bg p-4">
        <div className="share-surface-in w-full max-w-[400px] rounded-2xl border border-border bg-surface px-8 py-9 shadow-[0_16px_40px_-16px_rgba(0,0,0,0.25)] text-left">
          <h1 className="text-[17px] font-semibold text-text tracking-[0] mb-2">Plan not found</h1>
          <p className="text-[13px] text-tertiary leading-[1.5]">
            This link may have been revoked or the plan no longer exists.
          </p>
        </div>
      </div>
    );
  } else {
    const { entries, renderContent, renderMode } = outline;

    body = (
      <div
        ref={fullscreen.ref}
        style={
          fullscreen.isFullscreen
            ? { background: 'var(--bg)', overflow: 'auto', height: '100%' }
            : undefined
        }
        className={fullscreen.isFullscreen ? 'main-scroll' : undefined}
      >
        <div
          className={`min-h-screen bg-bg text-text${fullscreen.isFullscreen ? '' : ' main-scroll'}`}
        >
          {entries.filter((e) => e.source !== 'fallback_root').length >= 2 && (
            <PlanOutline entries={entries} pinned={!outlineHidden} />
          )}
          <div
            key={plan._id}
            className="share-reveal max-w-[720px] mx-auto px-8 pt-10 pb-20 [--share-delay:0ms]"
          >
            {/* Header */}
            <div className="mb-8 pb-6 border-b border-border">
              <div className="flex items-center gap-1 text-[12px] text-tertiary mb-2.5 font-[450]">
                <span className="flex items-center gap-1.5">
                  <AgentIcon agent={plan.agent} size={13} />
                  <span>{getAgentLabel(plan.agent)}</span>
                </span>
              </div>

              <h1 className="text-[26px] font-semibold tracking-[0] leading-[1.25] text-text mb-3">
                {plan.title}
              </h1>

              <div className="flex items-center gap-5 text-[12.5px] text-secondary">
                {plan.createdAt && (
                  <span className="flex items-center gap-1.5">
                    <ClockIcon />
                    {timeAgo(String(plan.createdAt))}
                  </span>
                )}
                <span className="flex items-center gap-1.5">
                  <DocIcon />
                  {plan.format.toUpperCase()}
                </span>
                <span className="text-[11px] font-medium py-0.5 px-2 rounded-md border border-border text-secondary bg-[color-mix(in_srgb,var(--text)_6%,transparent)]">
                  Shared
                </span>
              </div>

              <div className="flex items-center gap-2 mt-4">
                <button
                  type="button"
                  onClick={() => fullscreen.toggle()}
                  title={fullscreen.isFullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'}
                  className="flex items-center gap-[5px] text-[12.5px] font-medium rounded-[7px] border border-border bg-transparent text-secondary cursor-pointer"
                  style={{ padding: '5px 12px', fontFamily: 'inherit' }}
                >
                  {fullscreen.isFullscreen ? <ExitFullscreenIcon /> : <FullscreenIcon />}
                  {fullscreen.isFullscreen ? 'Exit' : 'Fullscreen'}
                </button>
              </div>
            </div>

            {/* Body */}
            {renderMode === 'markdown' ? (
              <article className="plan-markdown">
                <div id="plan-top" aria-hidden="true" />
                <Markdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema], rehypeSlug]}
                  components={{
                    code({ className, children, node: _node, ...props }) {
                      const code = String(children).replace(/\n$/, '');
                      const language = /(?:lang|language)-([^\s]+)/.exec(className ?? '')?.[1];
                      const isBlock = Boolean(language) || code.includes('\n');

                      if (!isBlock) {
                        return (
                          <code className={className} {...props}>
                            {children}
                          </code>
                        );
                      }

                      return (
                        <MarkdownCodeBlock className={className} code={code} language={language} />
                      );
                    },
                  }}
                >
                  {renderContent}
                </Markdown>
              </article>
            ) : (
              <>
                <div id="plan-top" aria-hidden="true" />
                <pre className="plan-plain">{renderContent}</pre>
              </>
            )}

            {/* Comments */}
            <CommentThread planId={plan._id} shareToken={token} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <CommandPalette
        search={paletteSearch}
        onSearch={setPaletteSearch}
        plans={[]}
        selectedId={undefined}
        onSelectPlan={() => {
          // No plan switching in shared view
        }}
        isPro={false}
        mode="cloud"
        hideTrigger
        onNewPlan={sharedHome}
        onUpload={sharedHome}
        onHistory={sharedHome}
        onNavigate={(path: string) => navigate(path)}
        onShowPricing={sharedHome}
        onToggleOutline={toggleOutline}
      />
      {body}
    </>
  );
}

function ClockIcon() {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      className="w-[13px] h-[13px] opacity-40"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
      />
    </svg>
  );
}

function DocIcon() {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      className="w-[13px] h-[13px] opacity-40"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
      />
    </svg>
  );
}
