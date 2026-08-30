import { expect, test } from 'bun:test';
import { deleteAccount, getMyPrivacyPreferences } from './account';
import { getCurrentUser } from './auth';
import { toPlanMetadataDto } from './planMetadata';
import { getMyPublishedPlans, getPlan, publishPlan } from './plans';
import { createShareLink, getShareLinks, getSharedPlanWithPassword } from './sharing';
import {
  createCheckoutSession,
  getMySubscriptionQuery,
  hasCompletedOnboarding,
} from './subscriptions';

type RegisteredPublicFunction = {
  exportArgs(): string;
  exportReturns(): string;
};

type ValidatorJson =
  | null
  | boolean
  | number
  | string
  | ValidatorJson[]
  | { [key: string]: ValidatorJson };

function exportedContract(fn: RegisteredPublicFunction) {
  return {
    args: JSON.parse(fn.exportArgs()) as ValidatorJson,
    returns: JSON.parse(fn.exportReturns()) as ValidatorJson,
  };
}

function containsValidatorType(value: ValidatorJson, type: string): boolean {
  if (Array.isArray(value)) return value.some((entry) => containsValidatorType(entry, type));
  if (typeof value !== 'object' || value === null) return false;
  if (value.type === type) return true;
  return Object.values(value).some((entry) => containsValidatorType(entry, type));
}

function expectExplicitContract(fn: RegisteredPublicFunction) {
  const contract = exportedContract(fn);
  expect(contract.args).not.toBeNull();
  expect(containsValidatorType(contract.args, 'any')).toBe(false);
  expect(contract.returns).not.toBeNull();
  expect(containsValidatorType(contract.returns, 'any')).toBe(false);
  return contract;
}

test('auth and account functions publish exact empty args and response DTOs', () => {
  const auth = expectExplicitContract(getCurrentUser);
  expect(auth.args).toEqual({ type: 'object', value: {} });
  expect(JSON.stringify(auth.returns)).toContain('emailVerified');

  const preferences = expectExplicitContract(getMyPrivacyPreferences);
  expect(preferences.args).toEqual({ type: 'object', value: {} });
  expect(JSON.stringify(preferences.returns)).toContain('collectLocalIpAddress');
  expect(JSON.stringify(preferences.returns)).toContain('localIpDisclosureAcknowledgedAt');

  const deletion = expectExplicitContract(deleteAccount);
  expect(deletion.args).toEqual({ type: 'object', value: {} });
  expect(deletion.returns).toEqual({ type: 'null' });
});

test('plan functions validate metadata and expose bounded plan DTOs', () => {
  const publish = expectExplicitContract(publishPlan);
  expect(JSON.stringify(publish.args)).toContain('metadata');
  expect(containsValidatorType(publish.args, 'record')).toBe(true);
  expect(publish.returns).toEqual({ type: 'id', tableName: 'plans' });

  const list = expectExplicitContract(getMyPublishedPlans);
  expect(JSON.stringify(list.returns)).toContain('continueCursor');
  expect(JSON.stringify(list.returns)).toContain('pageStatus');

  const detail = expectExplicitContract(getPlan);
  const serializedDetail = JSON.stringify(detail.returns);
  expect(serializedDetail).toContain('content');
  expect(serializedDetail).toContain('metadata');
  expect(serializedDetail).not.toContain('passwordHash');
  expect(
    toPlanMetadataDto({
      git: {
        branch: 'main',
        repo: { host: 'github.com', owner: 'acme', name: 'agendex' },
      },
      tags: ['production', 'reviewed'],
      unsupported: [{ secret: 'drop-me' }],
    }),
  ).toEqual({
    git: {
      branch: 'main',
      repo: { host: 'github.com', owner: 'acme', name: 'agendex' },
    },
    tags: ['production', 'reviewed'],
  });
});

test('subscription functions distinguish no-argument, boolean, and session responses', () => {
  const subscription = expectExplicitContract(getMySubscriptionQuery);
  expect(subscription.args).toEqual({ type: 'object', value: {} });
  expect(JSON.stringify(subscription.returns)).toContain('stripeSubscriptionId');
  expect(JSON.stringify(subscription.returns)).toContain('currentPeriodEnd');

  const onboarding = expectExplicitContract(hasCompletedOnboarding);
  expect(onboarding.args).toEqual({ type: 'object', value: {} });
  expect(onboarding.returns).toEqual({ type: 'boolean' });

  const checkout = expectExplicitContract(createCheckoutSession);
  expect(JSON.stringify(checkout.args)).toContain('monthly');
  expect(JSON.stringify(checkout.args)).toContain('yearly');
  expect(JSON.stringify(checkout.returns)).toContain('url');
});

test('sharing functions expose public link DTOs without password hashes', () => {
  const create = expectExplicitContract(createShareLink);
  expect(JSON.stringify(create.returns)).toContain('password');

  const links = expectExplicitContract(getShareLinks);
  const serializedLinks = JSON.stringify(links.returns);
  expect(serializedLinks).toContain('hasPassword');
  expect(serializedLinks).not.toContain('passwordHash');

  const unlockedPlan = expectExplicitContract(getSharedPlanWithPassword);
  expect(JSON.stringify(unlockedPlan.args)).toContain('password');
  expect(JSON.stringify(unlockedPlan.returns)).toContain('content');
  expect(JSON.stringify(unlockedPlan.returns)).not.toContain('passwordHash');
});
