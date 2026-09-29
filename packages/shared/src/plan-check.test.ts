import { expect, test } from 'bun:test';
import { checkPlan } from './plan-check.ts';

test('plan check separates structural review from missing and ambiguous paths', () => {
  const check = checkPlan(
    { content: '# Refactor\n\nUpdate `src/a.ts`, `src/new.ts`, and `Button.tsx`.' },
    {
      'src/a.ts': { status: 'found' },
      'src/new.ts': { status: 'missing' },
      'Button.tsx': { status: 'ambiguous', matches: ['a/Button.tsx', 'b/Button.tsx'] },
    },
  );
  expect(check.fileCount).toBe(3);
  expect(check.checkedFileCount).toBe(3);
  expect(check.pathStatus).toBe('ready');
  expect(check.findings.map((finding) => finding.code)).toEqual([
    'verification',
    'acceptance-criteria',
    'missing-files',
    'ambiguous-files',
  ]);
  expect(check.findings.find((finding) => finding.code === 'missing-files')?.message).toContain(
    'intends to create',
  );
});

test('plan check detects verification and acceptance sections with content', () => {
  const check = checkPlan({
    content:
      '# Implement\n\n## Verification\n\n- Run `bun test`.\n\n## Acceptance criteria\n\n- The login survives refresh.\n',
  });
  expect(check.verificationDetected).toBe(true);
  expect(check.acceptanceCriteriaDetected).toBe(true);
  expect(check.findings).toEqual([]);
});

test('plan check recognizes inline steps without requiring a template', () => {
  const check = checkPlan({
    content:
      'Update the handler. Run `bun test`. Done when every request returns the expected result.',
  });
  expect(check.findings).toEqual([]);
});

test('pytest is a verification runner without requiring a second test word', () => {
  for (const command of ['pytest', 'pytest -q', 'pytest tests/test_auth.py']) {
    expect(
      checkPlan({ content: `Run \`${command}\`. Done when requests return 200.` })
        .verificationDetected,
    ).toBe(true);
  }
});

test('plan check does not report unavailable files as missing', () => {
  const check = checkPlan(
    { content: 'Update `src/a.ts` and `src/b.ts`.' },
    { 'src/a.ts': { status: 'found' } },
  );
  expect(check.pathStatus).toBe('partial');
  expect(check.checkedFileCount).toBe(1);
  expect(check.findings.some((finding) => finding.paths)).toBe(false);
  expect(checkPlan({ content: 'Update `src/a.ts`.' }).pathStatus).toBe('unavailable');
});

test('plan check does not treat empty sections or fenced example plans as evidence', () => {
  for (const content of [
    '# Plan\n\n## Verification\n\n## Acceptance criteria\n',
    '# Plan\n\n## Verification\n\n## Acceptance criteria:\n',
    '```md\n## Verification\nRun bun test\n## Acceptance criteria\nThe feature works\n```',
  ]) {
    const check = checkPlan({ content });
    expect(check.verificationDetected).toBe(false);
    expect(check.acceptanceCriteriaDetected).toBe(false);
  }
});

test('plan checks accept real fenced verification commands but reject placeholders and examples', () => {
  for (const content of [
    '## Verification\n\n```sh\nbun test\n```\n## Acceptance criteria\nRequests return 200.',
    '**Verification**\n```bash\ncargo test\n```\n**Acceptance criteria**\nNo requests are dropped.',
    '## Verification\n```sh\npytest -q\n```\n## Acceptance criteria\nNo requests are dropped.',
  ])
    expect(checkPlan({ content }).findings).toEqual([]);
  for (const content of [
    '## Verification\n- [ ] TBD\n## Acceptance criteria\n- TODO',
    '## Verification\n- TODO: choose tests\n## Acceptance criteria\nTBD: decide outcomes',
    '**Verification**\nTBD\n**Acceptance criteria**\nTBD',
    'Acceptance criteria: TBD',
    'Verify that TBD. Done when TBD.',
    '```md\n## Verification\nRun bun test\n## Acceptance criteria\nFeature works',
    '## Verification\n```md\nRun bun test\n```\n## Acceptance criteria\nTBD',
    '## Verification\n<!-- Run bun test -->\n## Acceptance criteria\n<!-- Everything works -->',
  ]) {
    const check = checkPlan({ content });
    expect(check.verificationDetected).toBe(false);
    expect(check.acceptanceCriteriaDetected).toBe(false);
  }
});
