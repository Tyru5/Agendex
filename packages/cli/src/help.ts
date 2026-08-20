export interface RenderHelpOptions {
  cliVersion: string;
  color?: boolean;
}

interface HelpCommand {
  command: string;
  description: string;
  examples?: string[];
}

interface HelpGroup {
  title: string;
  commands: HelpCommand[];
}

interface HelpFlag {
  flag: string;
  description: string;
}

interface HelpStyles {
  title(text: string): string;
  section(text: string): string;
  command(text: string): string;
  muted(text: string): string;
}

const COMMAND_WIDTH = 38;
const FLAG_WIDTH = 18;

const ANSI = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  gray: '\u001b[90m',
  cyan: '\u001b[36m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
};

const HELP_GROUPS: HelpGroup[] = [
  {
    title: 'Quick start',
    commands: [
      {
        command: 'start',
        description: 'Start the background sync daemon',
        examples: ['agendex', 'agendex start'],
      },
      { command: 'status', description: 'Show local/cloud health and recommended next steps' },
      {
        command: 'open',
        description: 'Open the Agendex dashboard in your browser',
        examples: ['agendex open --url <self-hosted-url>'],
      },
    ],
  },
  {
    title: 'Cloud account',
    commands: [
      {
        command: 'login',
        description: 'Authenticate via browser OAuth',
        examples: ['agendex login --url <self-hosted-url>'],
      },
      { command: 'logout', description: 'Clear the stored cloud token' },
      { command: 'view <url>', description: 'Open a shared plan URL in your browser' },
    ],
  },
  {
    title: 'Plan sources',
    commands: [
      { command: 'configure', description: 'Select which agents/adapters to index' },
      {
        command: 'add-dir <path>',
        description: 'Add a custom directory to scan for plans',
        examples: ['agendex add-dir ~/plans --live'],
      },
      {
        command: 'remove-dir <path>',
        description: 'Remove a custom plan directory',
        examples: ['agendex remove-dir ~/plans --live'],
      },
      { command: 'list-dirs', description: 'List configured custom plan directories' },
    ],
  },
  {
    title: 'Sync & upload',
    commands: [
      {
        command: 'sync',
        description: 'Run a one-shot scan and cloud sync',
        examples: ['agendex sync --force'],
      },
      {
        command: 'upload <path>',
        description: 'Upload a single Markdown plan file',
        examples: ['agendex upload plan.md --agent claude-code --open'],
      },
      {
        command: 'download <query>',
        description: 'Download a cloud plan by id, name, or name + agent',
        examples: [
          'agendex download <plan-id>',
          'agendex download "Add auth" --agent claude-code --format md',
          'agendex download "Add auth" --force',
        ],
      },
      {
        command: 'browse',
        description: 'Interactively select, view, save, or open a cloud plan',
        examples: [
          'agendex browse',
          'agendex browse --agent claude-code',
          'agendex browse "Add auth" --format md --out ./exports',
        ],
      },
    ],
  },
  {
    title: 'Hooks & review',
    commands: [
      {
        command: 'capture-plan --agent <agent>',
        description: 'Capture a plan from a hook JSON payload on stdin',
      },
      { command: 'hooks status', description: 'Show Claude Code, Codex, and Pi hook status' },
      {
        command: 'hooks install <agent|all>',
        description: 'Install hook integration',
        examples: ['agendex hooks install claude-code --preview'],
      },
      { command: 'hooks uninstall <agent|all>', description: 'Remove managed hook entries' },
      { command: 'review-plan --hook --agent <agent>', description: 'Run hook-native plan review' },
    ],
  },
  {
    title: 'Maintenance',
    commands: [
      { command: 'cleanup', description: 'Interactively remove cloud daemon records' },
      { command: 'cleanup --stale', description: 'Auto-remove stale cloud daemon records' },
      { command: 'upgrade', description: 'Upgrade the globally installed CLI' },
      { command: 'upgrade --force', description: 'Reinstall latest even when up to date' },
      { command: 'help', description: 'Show this help message' },
      { command: '--version, -v', description: 'Print CLI version' },
    ],
  },
];

const FLAGS: HelpFlag[] = [
  { flag: '--dev', description: 'Use the dev environment (~/.agendex-dev config dir)' },
];

function supportsColor(): boolean {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== '0') return true;
  return Boolean(process.stdout.isTTY);
}

function paint(enabled: boolean, code: string, text: string): string {
  return enabled ? `${code}${text}${ANSI.reset}` : text;
}

function createStyles(color: boolean): HelpStyles {
  return {
    title: (text) => paint(color, `${ANSI.bold}${ANSI.cyan}`, text),
    section: (text) => paint(color, ANSI.yellow, text),
    command: (text) => paint(color, ANSI.green, text),
    muted: (text) => paint(color, ANSI.gray, text),
  };
}

function commandLine(styles: HelpStyles, entry: HelpCommand): string {
  return `    ${styles.command(entry.command.padEnd(COMMAND_WIDTH))}${entry.description}`;
}

function exampleLine(styles: HelpStyles, examples: string[]): string {
  return `      ${styles.muted(examples.join('  |  '))}`;
}

function flagLine(styles: HelpStyles, flag: HelpFlag): string {
  return `  ${styles.command(flag.flag.padEnd(FLAG_WIDTH))}${flag.description}`;
}

export function renderHelp(options: RenderHelpOptions): string {
  const styles = createStyles(options.color ?? supportsColor());
  const lines: string[] = [];

  lines.push(styles.title('Agendex: local coding-agent plan sync'));
  lines.push(styles.muted(`CLI v${options.cliVersion}`));
  lines.push('');
  lines.push(`Usage: ${styles.command('agendex')} ${styles.muted('[OPTIONS] [COMMAND]')}`);
  lines.push('');
  lines.push(styles.section('Commands:'));

  for (const group of HELP_GROUPS) {
    lines.push(`  ${styles.section(`${group.title}:`)}`);
    for (const command of group.commands) {
      lines.push(commandLine(styles, command));
      if (command.examples && command.examples.length > 0) {
        lines.push(exampleLine(styles, command.examples));
      }
    }
    lines.push('');
  }

  lines.push(styles.section('Flags:'));
  for (const flag of FLAGS) lines.push(flagLine(styles, flag));
  lines.push('');
  lines.push(styles.section('Tip:'));
  lines.push(
    `  ${styles.muted('Run')} ${styles.command('agendex status')} ${styles.muted('to see daemon health, cloud sync state, and next steps.')}`,
  );

  return lines.join('\n');
}
