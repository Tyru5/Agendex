import type { MouseEvent, ReactNode } from 'react';

export type LegalPageKind = 'terms' | 'privacy';

export interface LegalPageProps {
  /** Which document to render. */
  kind: LegalPageKind;
  /** Called when the user activates the back link in the header. */
  onBack?: () => void;
  /** Path the brand mark + back affordance link to. Defaults to "/". */
  homeHref?: string;
}

const GITHUB_URL = 'https://github.com/Tyru5/agendex';
const CONTACT_URL = 'https://agendex.dev';
const EFFECTIVE_DATE = 'August 31, 2026';

const COPY: Record<LegalPageKind, { title: string; intro: string }> = {
  terms: {
    title: 'Terms of Service',
    intro:
      'These terms govern your use of the Agendex cloud service — the Cloud Pro dashboard, plan sync, sharing, and collaboration features.',
  },
  privacy: {
    title: 'Privacy Policy',
    intro:
      'Agendex is local-first by design. This policy explains exactly what data leaves your machine, what we store in the cloud, and what we never touch.',
  },
};

function LegalShell({ children }: { children: ReactNode }) {
  return (
    <main className="landing-page legal-page min-h-[100dvh]">
      <div className="landing-frame px-[clamp(18px,5vw,72px)] py-[clamp(56px,7vw,88px)]">
        {children}
      </div>
    </main>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section
      id={id}
      className="scroll-mt-24 border-t border-[var(--landing-border-subtle)] py-8 first:border-t-0 first:pt-0"
    >
      <h2 className="m-0 text-[20px] font-[740] leading-[1.2] tracking-[-0.02em] text-[var(--landing-text)]">
        {title}
      </h2>
      <div className="mt-3 grid gap-3">{children}</div>
    </section>
  );
}

function Body({ children }: { children: ReactNode }) {
  return (
    <p className="m-0 max-w-[68ch] text-pretty text-[13.5px] leading-[1.7] text-[var(--landing-muted)]">
      {children}
    </p>
  );
}

function ListItem({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-baseline gap-2.5 text-[13px] leading-[1.6] text-[var(--landing-muted)]">
      <span aria-hidden className="text-[11px] font-bold text-[var(--landing-accent)]">
        •
      </span>
      <span>{children}</span>
    </li>
  );
}

function List({ items }: { items: ReadonlyArray<[id: string, content: ReactNode]> }) {
  return (
    <ul className="m-0 grid max-w-[68ch] list-none gap-2 p-0">
      {items.map(([id, content]) => (
        <ListItem key={id}>{content}</ListItem>
      ))}
    </ul>
  );
}

function Callout({ children }: { children: ReactNode }) {
  return (
    <div className="max-w-[68ch] rounded-[7px] border border-[var(--landing-border)] border-l-2 border-l-[var(--landing-accent)] bg-[var(--landing-surface)] px-4 py-3 text-[13px] leading-[1.65] text-[var(--landing-muted)]">
      {children}
    </div>
  );
}

function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className="font-semibold text-[var(--landing-accent)] underline decoration-[var(--landing-border)] underline-offset-2 hover:decoration-[var(--landing-accent)]"
    >
      {children}
    </a>
  );
}

export function LegalPage({ kind, onBack, homeHref = '/' }: LegalPageProps) {
  function handleBack(e: MouseEvent<HTMLAnchorElement>) {
    if (!onBack) return;
    if (e.defaultPrevented) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    onBack();
  }

  const { title, intro } = COPY[kind];

  return (
    <LegalShell>
      <nav className="mb-10 flex flex-wrap items-center justify-between gap-4">
        <a
          href={homeHref}
          onClick={handleBack}
          className="text-[14px] font-bold text-[var(--landing-text)] no-underline"
        >
          Agendex<span className="text-[var(--landing-accent)]">.</span>
        </a>
        <div className="flex items-center gap-4">
          <a
            href={kind === 'terms' ? '/privacy' : '/terms'}
            className="text-[13px] font-semibold text-[var(--landing-muted)] no-underline hover:text-[var(--landing-text)]"
          >
            {kind === 'terms' ? 'Privacy Policy' : 'Terms of Service'}
          </a>
          <a
            href={homeHref}
            onClick={handleBack}
            className="landing-action landing-action--secondary landing-action--compact"
          >
            <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none">
              <path
                d="M19 12H5M12 5l-7 7 7 7"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Back
          </a>
        </div>
      </nav>

      <header className="mb-10 max-w-[68ch]">
        <h1 className="m-0 text-[32px] font-[740] leading-[1.1] tracking-[-0.02em] text-[var(--landing-text)]">
          {title}
        </h1>
        <p className="mt-4 mb-0 text-[13.5px] leading-[1.7] text-[var(--landing-muted)]">{intro}</p>
        <p className="mt-2 mb-0 text-[12px] font-semibold text-[var(--landing-faint)]">
          Effective {EFFECTIVE_DATE}
        </p>
      </header>

      {kind === 'terms' ? <TermsContent /> : <PrivacyContent />}
    </LegalShell>
  );
}

export function TermsOfServicePage(props: Omit<LegalPageProps, 'kind'>) {
  return <LegalPage {...props} kind="terms" />;
}

export function PrivacyPolicyPage(props: Omit<LegalPageProps, 'kind'>) {
  return <LegalPage {...props} kind="privacy" />;
}

function TermsContent() {
  return (
    <div>
      <Section id="scope" title="1. Agreement and scope">
        <Body>
          These Terms of Service ("Terms") form a binding agreement between you and Agendex
          governing your use of the Agendex cloud service — the Cloud Pro dashboard, plan sync,
          shareable links, comments, collections, and related collaboration features (the
          "Service").
        </Body>
        <Callout>
          The free, self-hosted Agendex software is not covered by these Terms. Your use of the open
          source code is governed by its license — AGPL-3.0 for most of the repository and the
          Agendex Enterprise License for <code>packages/ee/</code> (see{' '}
          <TextLink href={GITHUB_URL}>GitHub</TextLink>).
        </Callout>
        <Body>
          By creating an account or using the Service, you accept these Terms. If you use the
          Service on behalf of an organization, you represent that you are authorized to bind that
          organization.
        </Body>
      </Section>

      <Section id="accounts" title="2. Accounts">
        <Body>
          The Service uses passwordless sign-in through GitHub or Google OAuth. You are responsible
          for maintaining the security of the underlying provider account and for all activity that
          occurs under your Agendex account. You must be at least 13 years old (or the minimum
          digital-consent age in your jurisdiction, if higher) to use the Service.
        </Body>
      </Section>

      <Section id="subscriptions" title="3. Subscriptions and billing">
        <Body>
          Cloud Pro features are offered as paid subscriptions, billed monthly or annually through
          Stripe. Paid features may include a free trial period; we will tell you when a trial ends
          and what it converts into.
        </Body>
        <List
          items={[
            [
              'renewal',
              'Subscription fees are charged in advance at the start of each billing period and renew automatically until cancelled.',
            ],
            [
              'cancel',
              'You can cancel at any time; cancellation takes effect at the end of the current billing period and your workspace downgrades to the free tier.',
            ],
            [
              'stripe',
              'Payments are processed by Stripe. We never receive or store your full card details.',
            ],
            [
              'pricing',
              'Prices may change with at least 30 days of notice before your next renewal. Statutory refund rights, where applicable, are unaffected.',
            ],
          ]}
        />
      </Section>

      <Section id="content" title="4. Your content">
        <Body>
          Plans, comments, tags, and other material you submit to the Service ("Your Content")
          remain yours. You grant Agendex a limited license to store, process, reproduce, and
          display Your Content solely as needed to operate and provide the Service at your direction
          — for example, syncing a plan, rendering it in the dashboard, or serving it to teammates
          you invite.
        </Body>
        <Body>
          We do not use Your Content to train models, and we do not sell it or use it for
          advertising.
        </Body>
        <Callout>
          Share links make a plan viewable by anyone who has the link. Treat share links like
          secrets — anyone with the URL can read the shared plan.
        </Callout>
      </Section>

      <Section id="acceptable-use" title="5. Acceptable use">
        <Body>You agree not to:</Body>
        <List
          items={[
            [
              'unlawful',
              'use the Service to store or distribute unlawful, infringing, or malicious content;',
            ],
            [
              'access',
              "attempt to access other users' data, accounts, or workspaces without authorization;",
            ],
            [
              'resell',
              'resell, sublicense, or offer the Service (or the EE software) as a competing hosted product;',
            ],
            [
              'interfere',
              "interfere with the Service's operation, probe it for vulnerabilities without permission, or bypass usage limits; or",
            ],
            [
              'identity',
              'misrepresent your identity or your affiliation with any person or organization.',
            ],
          ]}
        />
        <Body>
          We may suspend or terminate accounts that violate these rules, with notice where
          practical.
        </Body>
      </Section>

      <Section id="availability" title="6. Availability and changes">
        <Body>
          We work hard to keep the Service available, but it is provided without a service-level
          commitment. We may add, change, or discontinue features; if a discontinuation materially
          affects a paid subscription, we will give reasonable notice and a refund for the unused
          portion of the affected billing period.
        </Body>
      </Section>

      <Section id="termination" title="7. Termination">
        <Body>
          You may stop using the Service and delete your account at any time from Account settings.
          We may suspend or terminate your account if you materially breach these Terms, or if
          required by law. On termination, Your Content in the cloud becomes inaccessible, and we
          delete it in accordance with our retention practices described in the{' '}
          <TextLink href="/privacy">Privacy Policy</TextLink>. Your locally indexed plans are never
          affected — they live on your machine.
        </Body>
      </Section>

      <Section id="disclaimers" title="8. Disclaimers">
        <Body>
          THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE", WITHOUT WARRANTIES OF ANY KIND,
          EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND
          NON-INFRINGEMENT. We do not warrant that the Service will be uninterrupted or error-free.
        </Body>
      </Section>

      <Section id="liability" title="9. Limitation of liability">
        <Body>
          To the maximum extent permitted by law, Agendex will not be liable for indirect,
          incidental, special, consequential, or punitive damages, or for lost profits, data, or
          goodwill, arising from your use of the Service. Our total aggregate liability for any
          claim relating to the Service is limited to the greater of the amounts you paid us in the
          twelve months before the claim arose or USD $50.
        </Body>
        <Body>
          Nothing in these Terms limits liability that cannot be limited under applicable law,
          including liability for gross negligence, willful misconduct, or violations of statutory
          data-protection obligations.
        </Body>
      </Section>

      <Section id="governing-law" title="10. Governing law and venue">
        <Body>
          These Terms are governed by the laws of the State of Colorado, United States, without
          regard to its conflict-of-laws principles. Any dispute arising out of or relating to these
          Terms or the Service will be brought exclusively in the state or federal courts located in
          the State of Colorado, and you consent to their jurisdiction and venue.
        </Body>
      </Section>

      <Section id="changes" title="11. Changes to these Terms">
        <Body>
          We may update these Terms from time to time. If a change materially reduces your rights,
          we will notify you by email or through the Service at least 14 days before it takes
          effect. Continuing to use the Service after changes take effect means you accept the
          updated Terms.
        </Body>
      </Section>

      <Section id="contact" title="12. Contact">
        <Body>
          Questions about these Terms? Reach us at{' '}
          <TextLink href={CONTACT_URL}>agendex.dev</TextLink> or open an issue on{' '}
          <TextLink href={GITHUB_URL}>GitHub</TextLink>.
        </Body>
      </Section>
    </div>
  );
}

function PrivacyContent() {
  return (
    <div>
      <Section id="local-first" title="1. Local first">
        <Body>
          The free, self-hosted Agendex app runs entirely on your machine. It scans the agent plan
          directories you configure, indexes them locally, and talks to your local API server. With
          the local app alone, no plan data, plan metadata, or telemetry ever leaves your machine.
        </Body>
        <Body>
          The sections below describe the optional cloud Service — the Cloud Pro dashboard, plan
          sync, and sharing.
        </Body>
      </Section>

      <Section id="we-collect" title="2. What the cloud Service collects">
        <Body>When you use the cloud Service, we process:</Body>
        <List
          items={[
            [
              'account',
              <>
                <strong>Account information.</strong> Your name, email address, and avatar URL,
                provided by GitHub or Google when you sign in with OAuth. We never see your provider
                password.
              </>,
            ],
            [
              'plans',
              <>
                <strong>Plans you sync.</strong> The content of plans you (or your CLI daemon)
                explicitly upload, plus metadata such as title, agent, workspace, and timestamps.
                Plans are not scanned or uploaded from your machine without your configured sync.
              </>,
            ],
            [
              'git',
              <>
                <strong>Git provenance.</strong> When detected during sync, the repository URL,
                branch, commit, and pull-request references associated with a plan, to show where a
                plan came from.
              </>,
            ],
            [
              'device',
              <>
                <strong>Device provenance.</strong> Device ID, hostname, and local IP address
                attached to synced plans so you can tell which machine produced them. Local IP
                reporting can be disabled at any time in Account settings or with{' '}
                <code>AGENDEX_DISABLE_LOCAL_IP=1</code>.
              </>,
            ],
            [
              'billing',
              <>
                <strong>Billing data.</strong> Subscription status and billing email, processed by
                Stripe. We never receive or store your full card number.
              </>,
            ],
            [
              'analytics',
              <>
                <strong>Aggregate page analytics.</strong> The hosted web dashboard uses Vercel
                Analytics, which collects aggregate, cookieless page-view metrics. The desktop app
                disables it entirely.
              </>,
            ],
          ]}
        />
      </Section>

      <Section id="we-dont" title="3. What we never do">
        <List
          items={[
            ['no-sell', 'We do not sell personal data or plan content.'],
            ['no-ads', 'We do not run advertising or third-party ad trackers.'],
            ['no-training', 'We do not use your plans to train machine-learning models.'],
            [
              'no-scan',
              'We do not read plans that were never synced — we have no access to your machine.',
            ],
          ]}
        />
      </Section>

      <Section id="sharing" title="4. Sharing">
        <Body>
          A plan is visible only to you and the people in your workspace until you create a share
          link. Anyone with a share link can view that plan without signing in. Deleting the share
          link immediately revokes access.
        </Body>
      </Section>

      <Section id="retention" title="5. Retention and deletion">
        <Body>
          You can delete individual plans, and your account and workspace data, from the dashboard
          at any time. Deleting your account removes cloud copies of your plans, comments, and
          workspace metadata. We may retain backups for up to 30 days after deletion before they
          expire. Server logs are kept for a short operational window and then removed.
        </Body>
        <Callout>
          Deleting cloud data never deletes your local plans. Your locally indexed plans stay on
          your machine under your control.
        </Callout>
      </Section>

      <Section id="security" title="6. Security">
        <Body>
          Traffic to the Service is encrypted in transit. Cloud API access uses bearer tokens scoped
          to your account, and OAuth is delegated to GitHub and Google. We use strict transport
          security and standard hardening headers on hosted deployments. No system is perfectly
          secure; if you believe you have found a vulnerability, please report it via{' '}
          <TextLink href={GITHUB_URL}>GitHub</TextLink>.
        </Body>
      </Section>

      <Section id="rights" title="7. Your rights">
        <Body>
          Depending on where you live, you may have rights to access, correct, export, or delete
          your personal data, and to object to or restrict certain processing. You can exercise most
          of these rights directly in the dashboard (account settings, plan deletion). For anything
          else, contact us via <TextLink href={CONTACT_URL}>agendex.dev</TextLink> and we will
          respond within a reasonable timeframe.
        </Body>
      </Section>

      <Section id="children" title="8. Children">
        <Body>
          The Service is not directed at children under 13 (or the higher minimum consent age in
          your jurisdiction), and we do not knowingly collect their personal data.
        </Body>
      </Section>

      <Section id="policy-changes" title="9. Changes to this policy">
        <Body>
          We may update this policy as the Service evolves. Material changes will be announced in
          the dashboard or by email. The effective date at the top of this page always reflects the
          current version.
        </Body>
      </Section>

      <Section id="contact" title="10. Contact">
        <Body>
          Privacy questions? Reach us at <TextLink href={CONTACT_URL}>agendex.dev</TextLink> or open
          an issue on <TextLink href={GITHUB_URL}>GitHub</TextLink>.
        </Body>
      </Section>
    </div>
  );
}
