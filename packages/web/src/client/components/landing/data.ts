import { setToken } from '../../lib/api.ts';

export { setToken };

export const FAQ_ITEMS = [
  {
    q: 'What is Agendex?',
    a: 'Agendex indexes the plan and todo files your AI coding agents create, then gives you one place to search, review, comment, share, and track follow-up.',
  },
  {
    q: 'Which agents are supported?',
    a: 'Built-in adapters cover Claude Code, Cursor, Codex CLI, Windsurf, Amp, Cline, GitHub Copilot, OpenCode, Continue, Aider, Droid, Kilo Code, Roo Code, Goose, Gemini CLI, and more. Adding another agent means implementing one adapter.',
  },
  {
    q: 'Is my data private?',
    a: 'Self-hosted data stays on your machine. Cloud sync sends plan data to your Agendex account, and nothing becomes public unless you share it.',
  },
  {
    q: 'Can I switch from self-hosted to Cloud later?',
    a: 'Yes. Install the CLI, run `agendex login`, and start the daemon. Your local plans sync to Cloud without a migration step.',
  },
  {
    q: 'Do I need to pay to use Agendex?',
    a: 'No. Self-hosted is free and open source. Cloud Pro is $7/month or $69/year for sync, sharing, comments, charts, plan creation, and up to five workspace members.',
  },
  {
    q: 'How does Cloud sync work?',
    a: 'The CLI daemon watches configured plan directories and pushes changes to your account in real time while leaving local files readable on disk.',
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
    code: `git clone https://github.com/tiru5/agendex.git\ncd agendex && bun install`,
  },
  {
    number: '2',
    title: 'Start Dev Servers',
    code: `bun run dev              # API server :4890\nbun run dev:client:oss   # Vite HMR  :5173`,
  },
  {
    number: '3',
    title: 'Connect',
    code: `# paste the auth token from your terminal`,
  },
];

export const PKG_MANAGERS = [
  { id: 'bun', label: 'bun', cmd: 'bun install -g agendex-cli' },
  { id: 'npm', label: 'npm', cmd: 'npm install -g agendex-cli' },
  { id: 'yarn', label: 'yarn', cmd: 'yarn global add agendex-cli' },
  { id: 'pnpm', label: 'pnpm', cmd: 'pnpm add -g agendex-cli' },
] as const;

export const CLOUD_STEPS = [
  { number: '1', title: 'Install CLI', code: 'npm install -g agendex-cli', hasPkgManager: true },
  { number: '2', title: 'Authenticate', code: 'agendex login        # opens browser OAuth' },
  { number: '3', title: 'Start Daemon', code: 'agendex start        # watches + syncs plans' },
  {
    number: '4',
    title: 'Open Dashboard',
    code: 'agendex open         # launches the web app in your browser',
  },
  {
    number: '5',
    title: 'Tune & Inspect',
    code: `agendex configure    # pick which agents to index
agendex add-dir <path>   # watch a custom plan directory
agendex status       # daemon health + connected devices`,
  },
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
  'Local plan indexing and search',
  'All agent adapters',
  'Full source access',
  'No account required',
];

export const PRO_FEATURES = [
  'Everything in Self-hosted',
  'Cloud sync from the CLI daemon',
  'Shareable plan links',
  'Comment threads',
  'Technology dependency charts',
  'New plan indicators',
  'Plan creation from the dashboard',
  'Up to five workspace members',
  'Access from any device',
];

export const MONEY_BACK_GUARANTEE = {
  label: '14-day money-back guarantee',
  body: 'If Cloud Pro is not a fit in your first 14 days, you get a full refund. No questions asked.',
} as const;
