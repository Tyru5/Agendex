import { setToken } from '../../lib/api.ts';

export { setToken };

export const FAQ_ITEMS = [
  {
    q: 'What is Agendex?',
    a: 'Agendex indexes plans and sessions produced by supported coding agents on your machine, then gives you one place to search, filter, inspect, and optionally sync them to Cloud Pro.',
  },
  {
    q: 'Which agents are supported?',
    a: 'Implemented adapters currently cover Claude Code, Codex CLI, Continue, Cursor, OpenCode, and Plannotator. The catalog includes additional stub entries, but those are not full adapters yet.',
  },
  {
    q: 'Is my data private?',
    a: 'Local OSS data stays on your machine. Cloud sync sends selected plan payloads to your Agendex account, and plans are not publicly visible unless you share them.',
  },
  {
    q: 'Can I switch from self-hosted to Cloud later?',
    a: 'Yes. Install the CLI, run `agendex login`, and start the daemon. Your local plans sync to Cloud without a migration step.',
  },
  {
    q: 'Do I need to pay to use Agendex?',
    a: 'No. Local OSS is free and open source. Cloud Pro is $7/month or $69/year for daemon sync, sharing, comments, tags, collections, history, dashboard plan creation, and up to five workspace members.',
  },
  {
    q: 'How does Cloud sync work?',
    a: 'The CLI daemon scans the same enabled adapters and custom source directories, skips unchanged payloads, prunes low-value noise, and pushes plan updates to your account while leaving local files readable on disk.',
  },
  {
    q: 'Is there a desktop app?',
    a: 'Yes. Agendex Desktop for macOS is available soon to Cloud Pro accounts — it bundles the local server and cloud dashboard in one window with browser-based sign-in. Download it from GitHub Releases. A Windows build is coming soon.',
  },
];

export const AGENTS = ['Claude Code', 'Codex', 'Continue', 'Cursor', 'OpenCode', 'Plannotator'];

export const LOCAL_STEPS = [
  {
    number: '1',
    title: 'Clone & Install',
    code: `git clone https://github.com/tyru5/agendex.git\ncd agendex && bun install`,
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

export const CLI_INSTALL_OPTIONS = [
  { id: 'installer', label: 'curl', cmd: 'curl -fsSL https://agendex.dev/install.sh | bash' },
  { id: 'powershell', label: 'PowerShell', cmd: 'irm https://agendex.dev/install.ps1 | iex' },
  { id: 'bun', label: 'bun', cmd: 'bun install -g agendex-cli' },
  { id: 'npm', label: 'npm', cmd: 'npm install -g agendex-cli' },
  { id: 'yarn', label: 'yarn', cmd: 'yarn global add agendex-cli' },
  { id: 'pnpm', label: 'pnpm', cmd: 'pnpm add -g agendex-cli' },
] as const;

export const CLOUD_STEPS = [
  {
    number: '1',
    title: 'Install CLI',
    code: `# macOS / Linux\ncurl -fsSL https://agendex.dev/install.sh | bash\n\n# Windows (PowerShell)\nirm https://agendex.dev/install.ps1 | iex`,
    hasPkgManager: true,
  },
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
    title: 'Desktop App',
    desc: 'The native macOS app is soon now for Cloud Pro accounts, bundling the local server and cloud dashboard in one window with browser-based sign-in. Windows is coming soon.',
  },
  {
    title: 'Instant Indexing',
    desc: 'File watchers and polling fallback keep supported adapter output and custom plan folders current.',
  },
  {
    title: 'Share Plans',
    desc: 'Sync a plan to Cloud Pro and generate a scoped share link when review needs to leave your machine.',
  },
  {
    title: 'Comments',
    desc: 'Cloud comments keep review feedback attached to the synced plan record.',
  },
  {
    title: 'Cloud Sync',
    desc: 'The CLI daemon pushes changed local plans to your account and keeps daemon/device status visible.',
  },
  {
    title: 'Fuzzy Search',
    desc: 'Search across indexed titles, content, agents, and workspaces from the local app.',
  },
  {
    title: 'Adapter System',
    desc: 'Enable implemented adapters, rescan them, and add custom plan source directories.',
  },
  {
    title: 'Plan History',
    desc: 'Cloud Pro stores plan versions so shared review can follow how agent output changes over time.',
  },
  {
    title: 'New Plan Tracking',
    desc: 'Local and cloud views can surface unseen plan updates while hiding low-value noise.',
  },
  {
    title: 'Plan Creation',
    desc: 'Cloud Pro can create, upload, and edit dashboard plans that did not originate from an adapter.',
  },
];

export const FREE_FEATURES = [
  'Local plan indexing and search',
  'Implemented agent adapters',
  'Custom plan source directories',
  'Full source access',
  'No account required',
];

export const PRO_FEATURES = [
  'Everything in Self-hosted',
  'Agendex Desktop app for macOS',
  'Cloud sync from the CLI daemon',
  'Shareable plan links',
  'Comment threads',
  'Tags, collections, and plan history',
  'Technology dependency charts',
  'Plannotator integration',
  'New plan indicators',
  'Plan creation, uploads, and editing',
  'Up to five workspace members',
  'Access from any device',
  '...and more!',
];

export const MONEY_BACK_GUARANTEE = {
  label: '14-day money-back guarantee',
  body: 'If Cloud Pro is not a fit in your first 14 days, you get a full refund. No questions asked.',
} as const;
