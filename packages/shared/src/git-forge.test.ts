import { describe, expect, test } from 'bun:test';
import {
  branchUrl,
  commitUrl,
  extractPlanGitContext,
  forgeKind,
  type GitRepoInfo,
  normalizePlanGitLink,
  parseRemoteUrl,
  planGitLinkUrl,
  prUrl,
  safeHttpUrl,
  sanitizeRemoteUrl,
} from './git-forge.ts';

const githubRepo: GitRepoInfo = {
  host: 'github.com',
  owner: 'acme',
  name: 'widgets',
  webUrl: 'https://github.com/acme/widgets',
};

describe('parseRemoteUrl', () => {
  test('parses scp-like ssh remotes', () => {
    expect(parseRemoteUrl('git@github.com:acme/widgets.git')).toEqual(githubRepo);
  });

  test('parses ssh:// remotes with user and port', () => {
    expect(parseRemoteUrl('ssh://git@github.com:22/acme/widgets.git')).toEqual(githubRepo);
  });

  test('parses https remotes and strips credentials', () => {
    expect(parseRemoteUrl('https://user:token@github.com/acme/widgets.git')).toEqual(githubRepo);
  });

  test('parses https remotes without .git suffix', () => {
    expect(parseRemoteUrl('https://github.com/acme/widgets')).toEqual(githubRepo);
  });

  test('keeps nested GitLab group paths in owner', () => {
    expect(parseRemoteUrl('git@gitlab.com:group/subgroup/tool.git')).toEqual({
      host: 'gitlab.com',
      owner: 'group/subgroup',
      name: 'tool',
      webUrl: 'https://gitlab.com/group/subgroup/tool',
    });
  });

  test('derives webUrl for http remotes on unknown hosts', () => {
    expect(parseRemoteUrl('https://git.example.com/team/app.git')).toEqual({
      host: 'git.example.com',
      owner: 'team',
      name: 'app',
      webUrl: 'https://git.example.com/team/app',
    });
  });

  test('omits webUrl for ssh remotes on unknown hosts', () => {
    const parsed = parseRemoteUrl('git@git.example.com:team/app.git');
    expect(parsed).toEqual({ host: 'git.example.com', owner: 'team', name: 'app' });
  });

  test('rejects non-remote strings', () => {
    expect(parseRemoteUrl('')).toBeNull();
    expect(parseRemoteUrl('not a remote')).toBeNull();
    expect(parseRemoteUrl('c:\\projects\\repo')).toBeNull();
    expect(parseRemoteUrl('git@github.com:only-owner')).toBeNull();
  });
});

describe('sanitizeRemoteUrl', () => {
  test('strips embedded credentials from scheme URLs', () => {
    expect(sanitizeRemoteUrl('https://x-access-token:secret@github.com/acme/widgets.git')).toBe(
      'https://github.com/acme/widgets.git',
    );
    expect(sanitizeRemoteUrl('ssh://git@github.com/acme/widgets.git')).toBe(
      'ssh://github.com/acme/widgets.git',
    );
  });

  test('leaves credential-free remotes unchanged', () => {
    expect(sanitizeRemoteUrl('https://github.com/acme/widgets.git')).toBe(
      'https://github.com/acme/widgets.git',
    );
    expect(sanitizeRemoteUrl('git@github.com:acme/widgets.git')).toBe(
      'git@github.com:acme/widgets.git',
    );
  });
});

describe('forgeKind', () => {
  test('recognizes hosted and self-managed forges', () => {
    expect(forgeKind('github.com')).toBe('github');
    expect(forgeKind('gitlab.com')).toBe('gitlab');
    expect(forgeKind('gitlab.example.io')).toBe('gitlab');
    expect(forgeKind('bitbucket.org')).toBe('bitbucket');
    expect(forgeKind('git.example.com')).toBeNull();
  });
});

describe('forge URL builders', () => {
  test('builds GitHub URLs', () => {
    expect(branchUrl(githubRepo, 'feat/git-links')).toBe(
      'https://github.com/acme/widgets/tree/feat/git-links',
    );
    expect(commitUrl(githubRepo, 'abc1234')).toBe('https://github.com/acme/widgets/commit/abc1234');
    expect(prUrl(githubRepo, 42)).toBe('https://github.com/acme/widgets/pull/42');
  });

  test('builds GitLab URLs', () => {
    const repo: GitRepoInfo = {
      host: 'gitlab.com',
      owner: 'group',
      name: 'tool',
      webUrl: 'https://gitlab.com/group/tool',
    };
    expect(branchUrl(repo, 'main')).toBe('https://gitlab.com/group/tool/-/tree/main');
    expect(commitUrl(repo, 'abc1234')).toBe('https://gitlab.com/group/tool/-/commit/abc1234');
    expect(prUrl(repo, 7)).toBe('https://gitlab.com/group/tool/-/merge_requests/7');
  });

  test('builds Bitbucket URLs', () => {
    const repo: GitRepoInfo = {
      host: 'bitbucket.org',
      owner: 'team',
      name: 'app',
      webUrl: 'https://bitbucket.org/team/app',
    };
    expect(branchUrl(repo, 'main')).toBe('https://bitbucket.org/team/app/branch/main');
    expect(commitUrl(repo, 'abc1234')).toBe('https://bitbucket.org/team/app/commits/abc1234');
    expect(prUrl(repo, 3)).toBe('https://bitbucket.org/team/app/pull-requests/3');
  });

  test('returns undefined without a webUrl or for unknown forges', () => {
    expect(branchUrl(undefined, 'main')).toBeUndefined();
    const unknown: GitRepoInfo = {
      host: 'git.example.com',
      owner: 'team',
      name: 'app',
      webUrl: 'https://git.example.com/team/app',
    };
    expect(prUrl(unknown, 1)).toBeUndefined();
  });

  test('percent-encodes branch segments but keeps slashes', () => {
    expect(branchUrl(githubRepo, 'feat/hash#name')).toBe(
      'https://github.com/acme/widgets/tree/feat/hash%23name',
    );
  });
});

describe('normalizePlanGitLink', () => {
  test('classifies PR numbers with and without hash', () => {
    expect(normalizePlanGitLink('#42', githubRepo)).toEqual({
      ok: true,
      link: { type: 'pr', value: '#42', url: 'https://github.com/acme/widgets/pull/42' },
    });
    expect(normalizePlanGitLink('42', githubRepo)).toEqual({
      ok: true,
      link: { type: 'pr', value: '#42', url: 'https://github.com/acme/widgets/pull/42' },
    });
  });

  test('classifies commit SHAs', () => {
    const sha = 'ABCDEF1234567890abcdef1234567890abcdef12';
    expect(normalizePlanGitLink(sha, githubRepo)).toEqual({
      ok: true,
      link: {
        type: 'commit',
        value: sha.toLowerCase(),
        url: `https://github.com/acme/widgets/commit/${sha.toLowerCase()}`,
      },
    });
  });

  test('classifies PR URLs across forges', () => {
    expect(normalizePlanGitLink('https://github.com/acme/widgets/pull/7')).toEqual({
      ok: true,
      link: { type: 'pr', value: '#7', url: 'https://github.com/acme/widgets/pull/7' },
    });
    expect(normalizePlanGitLink('https://gitlab.com/g/t/-/merge_requests/9')).toEqual({
      ok: true,
      link: { type: 'pr', value: '#9', url: 'https://gitlab.com/g/t/-/merge_requests/9' },
    });
    expect(normalizePlanGitLink('https://bitbucket.org/t/a/pull-requests/3')).toEqual({
      ok: true,
      link: { type: 'pr', value: '#3', url: 'https://bitbucket.org/t/a/pull-requests/3' },
    });
  });

  test('classifies commit and branch URLs', () => {
    expect(normalizePlanGitLink('https://github.com/acme/widgets/commit/abc1234')).toEqual({
      ok: true,
      link: {
        type: 'commit',
        value: 'abc1234',
        url: 'https://github.com/acme/widgets/commit/abc1234',
      },
    });
    expect(normalizePlanGitLink('https://github.com/acme/widgets/tree/feat/x')).toEqual({
      ok: true,
      link: { type: 'branch', value: 'feat/x', url: 'https://github.com/acme/widgets/tree/feat/x' },
    });
  });

  test('treats plain text as a branch name', () => {
    expect(normalizePlanGitLink('feat/git-links', githubRepo)).toEqual({
      ok: true,
      link: {
        type: 'branch',
        value: 'feat/git-links',
        url: 'https://github.com/acme/widgets/tree/feat/git-links',
      },
    });
  });

  test('branch without repo omits url', () => {
    expect(normalizePlanGitLink('main')).toEqual({
      ok: true,
      link: { type: 'branch', value: 'main' },
    });
  });

  test('rejects empty, whitespace, oversized, and unrecognized URL input', () => {
    expect(normalizePlanGitLink('  ').ok).toBe(false);
    expect(normalizePlanGitLink('two words').ok).toBe(false);
    expect(normalizePlanGitLink('x'.repeat(600)).ok).toBe(false);
    expect(normalizePlanGitLink('https://example.com/docs').ok).toBe(false);
  });
});

describe('safeHttpUrl', () => {
  test('allows http(s) and strips credentials', () => {
    expect(safeHttpUrl('https://github.com/acme/widgets')).toBe('https://github.com/acme/widgets');
    expect(safeHttpUrl('http://example.com/path')).toBe('http://example.com/path');
    expect(safeHttpUrl('https://user:token@github.com/acme/widgets')).toBe(
      'https://github.com/acme/widgets',
    );
  });

  test('rejects non-http schemes and malformed URLs', () => {
    expect(safeHttpUrl('javascript:alert(1)')).toBeUndefined();
    expect(safeHttpUrl('data:text/html,<script>alert(1)</script>')).toBeUndefined();
    expect(safeHttpUrl('vbscript:msgbox(1)')).toBeUndefined();
    expect(safeHttpUrl('not a url')).toBeUndefined();
    expect(safeHttpUrl(undefined)).toBeUndefined();
  });

  test('optionally requires the URL host to match', () => {
    expect(safeHttpUrl('https://github.com/acme/widgets', { expectedHost: 'github.com' })).toBe(
      'https://github.com/acme/widgets',
    );
    expect(
      safeHttpUrl('https://evil.example/acme/widgets', { expectedHost: 'github.com' }),
    ).toBeUndefined();
  });
});

describe('extractPlanGitContext', () => {
  test('reads sync-enriched metadata.git with repo info', () => {
    const context = extractPlanGitContext({
      git: {
        branch: 'main',
        commit: 'abc1234',
        remoteUrl: 'git@github.com:acme/widgets.git',
        repo: githubRepo,
      },
    });
    expect(context).toEqual({
      branch: 'main',
      commit: 'abc1234',
      remoteUrl: 'git@github.com:acme/widgets.git',
      repo: githubRepo,
    });
  });

  test('derives repo from remoteUrl when repo is missing', () => {
    const context = extractPlanGitContext({
      git: { remoteUrl: 'git@github.com:acme/widgets.git' },
    });
    expect(context?.repo).toEqual(githubRepo);
  });

  test('falls back to legacy adapter branch/commit metadata', () => {
    expect(extractPlanGitContext({ branch: 'work', commit: 'def5678' })).toEqual({
      branch: 'work',
      commit: 'def5678',
    });
  });

  test('returns null when no git metadata exists', () => {
    expect(extractPlanGitContext({})).toBeNull();
    expect(extractPlanGitContext(undefined)).toBeNull();
    expect(extractPlanGitContext({ git: {} })).toBeNull();
  });

  test('rejects crafted javascript/data webUrl and rebuilds a safe forge URL', () => {
    const context = extractPlanGitContext({
      git: {
        repo: {
          host: 'github.com',
          owner: 'acme',
          name: 'widgets',
          webUrl: 'javascript:alert(document.cookie)',
        },
      },
    });
    expect(context?.repo?.webUrl).toBe('https://github.com/acme/widgets');
  });

  test('rejects webUrl whose host does not match repo.host', () => {
    const context = extractPlanGitContext({
      git: {
        repo: {
          host: 'github.com',
          owner: 'acme',
          name: 'widgets',
          webUrl: 'https://evil.example/phishing',
        },
      },
    });
    expect(context?.repo?.webUrl).toBe('https://github.com/acme/widgets');
  });
});

describe('normalizePlanGitLink rejects non-http schemes', () => {
  test('rejects javascript and data URLs', () => {
    expect(normalizePlanGitLink('javascript:alert(1)').ok).toBe(false);
    expect(normalizePlanGitLink('data:text/html,hi').ok).toBe(false);
  });
});

describe('planGitLinkUrl', () => {
  test('prefers stored url and resolves bare values against the repo', () => {
    expect(planGitLinkUrl({ type: 'pr', value: '#1', url: 'https://x.test/p/1' })).toBe(
      'https://x.test/p/1',
    );
    expect(planGitLinkUrl({ type: 'pr', value: '#42' }, githubRepo)).toBe(
      'https://github.com/acme/widgets/pull/42',
    );
    expect(planGitLinkUrl({ type: 'branch', value: 'main' }, githubRepo)).toBe(
      'https://github.com/acme/widgets/tree/main',
    );
    expect(planGitLinkUrl({ type: 'commit', value: 'abc1234' })).toBeUndefined();
  });

  test('ignores stored non-http urls and falls back to repo builders', () => {
    expect(
      planGitLinkUrl({ type: 'pr', value: '#42', url: 'javascript:alert(1)' }, githubRepo),
    ).toBe('https://github.com/acme/widgets/pull/42');
    expect(
      planGitLinkUrl({ type: 'commit', value: 'abc1234', url: 'data:text/html,x' }),
    ).toBeUndefined();
  });
});
