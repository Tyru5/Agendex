import { expect, test } from 'bun:test';
import {
  computeContentHash,
  computePlanSyncIdentity,
  exactDuplicateKey,
  normalizeSyncPath,
  relativeSyncPath,
} from './plan-sync-identity.ts';

const basePlan = {
  agent: 'cursor',
  title: 'Fix login',
  content: '# Plan\n\n- [ ] Fix login\n',
  format: 'md',
};

test('normalizes Windows and POSIX paths consistently enough for relative identity', () => {
  expect(normalizeSyncPath('C:\\Users\\Alice\\repo\\.cursor\\plans\\foo.plan.md')).toBe(
    'c:/Users/Alice/repo/.cursor/plans/foo.plan.md',
  );
  expect(relativeSyncPath('/Users/alice/repo/.cursor/plans/foo.plan.md', '/Users/alice/repo')).toBe(
    '.cursor/plans/foo.plan.md',
  );
  expect(
    relativeSyncPath(
      'C:\\Users\\Alice\\repo\\.cursor\\plans\\foo.plan.md',
      'C:\\Users\\Alice\\repo',
    ),
  ).toBe('.cursor/plans/foo.plan.md');
});

test('computes the same project-relative sync key across machines', () => {
  const mac = computePlanSyncIdentity({
    ...basePlan,
    filePath: '/Users/alice/repo/.cursor/plans/foo.plan.md',
    workspace: '/Users/alice/repo',
  });
  const windows = computePlanSyncIdentity({
    ...basePlan,
    filePath: 'C:\\Users\\Alice\\repo\\.cursor\\plans\\foo.plan.md',
    workspace: 'C:\\Users\\Alice\\repo',
  });

  expect(mac.syncIdentityKey).toBe('v1:cursor:path:.cursor/plans/foo.plan.md');
  expect(windows.syncIdentityKey).toBe(mac.syncIdentityKey);
  expect(windows.identityStrength).toBe('path');
});

test('computes stable sync keys for global ~/.cursor/plans files', () => {
  const identity = computePlanSyncIdentity({
    ...basePlan,
    filePath: '/Users/alice/.cursor/plans/foo.plan.md',
    metadata: {
      source: 'global-cursor',
      userPlansDir: '/Users/alice/.cursor/plans',
    },
  });

  expect(identity.syncIdentityKey).toBe('v1:cursor:global-cursor:path:foo.plan.md');
  expect(identity.identityStrength).toBe('path');
});

test('prefers stable metadata session ids over path identity', () => {
  const identity = computePlanSyncIdentity({
    ...basePlan,
    agent: 'codex-cli',
    filePath: '/tmp/random/rollout.jsonl',
    workspace: '/tmp/random',
    metadata: { sessionId: 'sess_123' },
  });

  expect(identity.syncIdentityKey).toBe('v1:codex-cli:metadata:sessionId:sess_123');
  expect(identity.identityStrength).toBe('strong');
});

test('falls back to content identity without merging different content by title alone', () => {
  const first = computePlanSyncIdentity({ ...basePlan, filePath: '/tmp/a.md' });
  const second = computePlanSyncIdentity({
    ...basePlan,
    content: '# Plan\n\n- [ ] Fix signup\n',
    filePath: '/tmp/b.md',
  });

  expect(first.syncIdentityKey).toBeUndefined();
  expect(second.syncIdentityKey).toBeUndefined();
  expect(first.contentHash).not.toBe(second.contentHash);
});

test('content hash normalizes line endings and trailing whitespace', () => {
  const unix = computeContentHash({ title: 'A', content: 'hello\nworld\n', format: 'md' });
  const windows = computeContentHash({
    title: 'A',
    content: 'hello\r\nworld\r\n\r\n',
    format: 'md',
  });

  expect(windows).toBe(unix);
  expect(computeContentHash({ title: 'A', content: 'hello\r\nworld\r\n', format: 'md' })).toBe(
    unix,
  );
});

test('exact duplicate key combines agent title and content hash', () => {
  expect(exactDuplicateKey({ agent: 'cursor', title: ' Fix   Login ', contentHash: 'abc' })).toBe(
    'cursor:fix login:abc',
  );
});
