import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function writeQaBootstrapEvidence(payload: unknown): void {
  const path = process.env.AGENDEX_DESKTOP_QA_BOOTSTRAP_PATH;
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

export function writeQaStartupEvidence(payload: unknown): void {
  const path = process.env.AGENDEX_DESKTOP_QA_STARTUP_PATH;
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(payload)}\n`, 'utf8');
}
