import { homedir } from 'os';
import { join } from 'path';
import type { AgentAdapter, Plan } from './types.ts';

function createStub(agent: string, searchPaths: string[], matchExt: string): AgentAdapter {
  return {
    agent,
    writable: false,
    getSearchPaths: () => searchPaths,
    getWatchPaths: () => searchPaths,
    matches: (fp: string) => fp.endsWith(matchExt),
    parse: async () => [],
    write: async () => false,
  };
}

const home = homedir();

export const ampAdapter = createStub('amp', [join(home, '.amp')], '.json');

export const clineAdapter = createStub(
  'cline',
  [
    join(home, 'AppData', 'Roaming', 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev'),
    join(home, '.config', 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev'),
  ],
  '.json',
);

export const copilotChatAdapter = createStub(
  'copilot-chat',
  [join(home, '.vscode', 'User', 'workspaceStorage')],
  '.json',
);

export const droidAdapter = createStub('droid', [join(home, '.factory', 'droids')], '.md');

export const kiloCliAdapter = createStub('kilo-cli', [join(home, '.kilo')], '.md');

export const windsurfAdapter = createStub('windsurf', [join(home, '.cascade_backups')], '.md');

export const aiderAdapter = createStub('aider', [join(home, '.aider')], '.aider.chat.history.md');
