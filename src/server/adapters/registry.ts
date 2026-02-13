import type { AgentAdapter } from './types.ts';
import { claudeCodeAdapter } from './claude-code.ts';
import { codexCliAdapter } from './codex-cli.ts';
import { continueIdeAdapter } from './continue-ide.ts';
import { cursorAdapter } from './cursor.ts';
import { ohMyOpencodeAdapter } from './oh-my-opencode.ts';
import {
  ampAdapter,
  clineAdapter,
  copilotChatAdapter,
  droidAdapter,
  kiloCliAdapter,
  windsurfAdapter,
  aiderAdapter,
} from './stub.ts';

export const adapters: AgentAdapter[] = [
  claudeCodeAdapter,
  codexCliAdapter,
  continueIdeAdapter,
  cursorAdapter,
  ohMyOpencodeAdapter,
  ampAdapter,
  clineAdapter,
  copilotChatAdapter,
  droidAdapter,
  kiloCliAdapter,
  windsurfAdapter,
  aiderAdapter,
];
