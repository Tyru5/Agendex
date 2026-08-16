import { expect, test } from 'bun:test';
import { renderHelp } from './help.ts';

test('renders grouped help with usage, command categories, and flags', () => {
  const output = renderHelp({ cliVersion: '2.0.0', color: false });

  expect(output).toContain('Agendex: local coding-agent plan sync');
  expect(output).toContain('CLI v2.0.0');
  expect(output).toContain('Usage: agendex [OPTIONS] [COMMAND]');
  expect(output).toContain('Commands:');
  expect(output).toContain('Quick start:');
  expect(output).toContain('Cloud account:');
  expect(output).toContain('Plan sources:');
  expect(output).toContain('Sync & upload:');
  expect(output).toContain('Hooks & review:');
  expect(output).toContain('Maintenance:');
  expect(output).toContain('status');
  expect(output).toContain('Show local/cloud health and recommended next steps');
  expect(output).toContain('agendex hooks install claude-code --preview');
  expect(output).toContain('download <query>');
  expect(output).toContain('Download a cloud plan by id, name, or name + agent');
  expect(output).toContain('agendex download "Add auth" --force');
  expect(output).toContain('browse');
  expect(output).toContain('Interactively select, view, save, or open a cloud plan');
  expect(output).toContain('agendex browse --agent claude-code');
  expect(output).toContain('--dev');
  expect(output).toContain('agendex status');
});

test('renders color when explicitly enabled', () => {
  const output = renderHelp({ cliVersion: '2.0.0', color: true });

  expect(output).toContain('\u001b[');
  expect(output).toContain('Agendex: local coding-agent plan sync');
});
