import { setToken } from '../../lib/api.ts';

export { setToken };

export const FAQ_ITEMS = [
  {
    q: 'What is Agendex?',
    a: "Agendex indexes the plan/todo files that AI coding agents create (like Claude Code's plan.md) and surfaces them in a single dashboard. Search, comment, share, and track plans across all your agents.",
  },
  {
    q: 'Which agents are supported?',
    a: 'Claude Code, Cursor, Codex CLI, Windsurf, Amp, Cline, GitHub Copilot, OpenCode, Continue, Aider, Droid, Kilo Code, Roo Code, Goose, Gemini CLI, and more. Adding a new agent is just implementing a single adapter interface.',
  },
  {
    q: 'Is my data private?',
    a: 'With self-hosted, your data never leaves your machine. With Cloud, plans are synced to your account and only accessible to you unless you explicitly share them.',
  },
  {
    q: 'Can I switch from self-hosted to Cloud later?',
    a: 'Yes. Install the CLI, run `agendex login`, and start the daemon. Your local plans sync to the cloud automatically — no migration needed.',
  },
  {
    q: 'Do I need to pay to use Agendex?',
    a: 'Self-hosted is completely free and open source. Cloud Pro is $7/month ($69/year) and includes cloud sync, sharing, comments, technology dependency charts, new plan tracking, plan creation from the dashboard, workspace collaboration for up to 5 members, and access from any device.',
  },
  {
    q: 'How does Cloud sync work?',
    a: 'The CLI daemon watches your local plan files and pushes changes to the cloud in real time. Plans are synced automatically — just run `agendex start`.',
  },
];

export const AGENTS = [
  'Claude Code',
  'Cursor',
  'Codex',
  'Windsurf',
  'Amp',
  'Cline',
  'GitHub Copilot',
  'OpenCode',
  'Continue',
  'Aider',
  'Droid',
  'Kilo Code',
  'Roo Code',
  'Goose',
  'Gemini CLI',
];

export const LOCAL_STEPS = [
  {
    number: '1',
    title: 'Clone & Install',
    code: `git clone https://github.com/Tyru5/agendex.git\ncd agendex && bun install`,
  },
  {
    number: '2',
    title: 'Start Dev Servers',
    code: `bun run dev          # API server :4890\nbun run dev:client   # Vite HMR  :5173`,
  },
  {
    number: '3',
    title: 'Connect',
    code: `# paste the auth token from your terminal`,
  },
];

export const PKG_MANAGERS = [
  { id: 'bun', label: 'bun', cmd: 'bun install -g @agendex/cli' },
  { id: 'npm', label: 'npm', cmd: 'npm install -g @agendex/cli' },
  { id: 'yarn', label: 'yarn', cmd: 'yarn global add @agendex/cli' },
  { id: 'pnpm', label: 'pnpm', cmd: 'pnpm add -g @agendex/cli' },
] as const;

export const CLOUD_STEPS = [
  { number: '1', title: 'Install CLI', code: 'npm install -g @agendex/cli', hasPkgManager: true },
  { number: '2', title: 'Authenticate', code: 'agendex login        # opens browser OAuth' },
  { number: '3', title: 'Start Daemon', code: 'agendex start        # watches + syncs plans' },
];

export const FEATURES = [
  {
    icon: '⚡',
    title: 'Instant Indexing',
    desc: 'File watchers detect new plans the moment your agents create them. No polling, no manual refresh.',
  },
  {
    icon: '🔗',
    title: 'Share Plans',
    desc: 'Publish any plan to the cloud and generate shareable links. Control access with token-based permissions.',
  },
  {
    icon: '💬',
    title: 'Comments',
    desc: 'Leave comments on any plan. Threaded discussions keep feedback attached to the plans that matter.',
  },
  {
    icon: '☁️',
    title: 'Cloud Sync',
    desc: 'The CLI daemon watches local plans and syncs them to the cloud automatically. Access your plans from anywhere.',
  },
  {
    icon: '🔍',
    title: 'Fuzzy Search',
    desc: 'Find any plan across all agents instantly with blazing-fast fuzzy search powered by Fuse.js.',
  },
  {
    icon: '🔌',
    title: 'Adapter System',
    desc: 'Modular adapters for each agent source. Enable or disable agents on the fly with zero config.',
  },
  {
    icon: '🧬',
    title: 'Tech Charts',
    desc: 'Visualize technology relationships extracted from your plans as interactive dependency graphs.',
  },
  {
    icon: '🔔',
    title: 'New Plan Tracking',
    desc: 'Unseen plan indicators highlight what changed since your last visit. Never miss an agent update.',
  },
  {
    icon: '📝',
    title: 'Plan Creation',
    desc: 'Create and upload plans directly from the dashboard. Draft plans in Markdown with live preview.',
  },
];

export const FREE_FEATURES = [
  'Local plan indexing & search',
  'All agent adapters',
  'Full source access',
  'No accounts or dependencies',
];

export const PRO_FEATURES = [
  'Everything in Self-Hosted',
  'Cloud sync via CLI daemon',
  'Shareable plan links',
  'Comment threads',
  'Technology dependency charts',
  'New plan tracking & indicators',
  'Plan creation from dashboard',
  'Up to 5 workspace members',
  'Access from any device',
];
