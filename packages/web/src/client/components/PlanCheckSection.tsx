import { checkPlan, type PlanCheck } from '@agendex/shared/plan-check';
import { useMemo } from 'react';
import type { PlanPathContextValue } from './PlanPathContext.tsx';

export function PlanCheckSection({
  plan,
  paths,
  checked,
}: {
  plan: { content: string; title?: string; metadata?: Record<string, unknown> };
  paths: PlanPathContextValue | null;
  checked?: PlanCheck;
}) {
  const check = useMemo(
    () => checked ?? checkPlan(plan, paths?.results),
    [checked, plan, paths?.results],
  );
  return (
    <details className="plan-check-section">
      <summary>
        <span>Plan check</span>
        <span className="plan-check-summary">
          {check.findings.length
            ? `${check.findings.length} to review`
            : check.pathStatus === 'ready'
              ? 'No issues detected'
              : 'File checks incomplete'}
          {' · '}
          {check.fileCount} file {check.fileCount === 1 ? 'reference' : 'references'}
        </span>
      </summary>
      <div className="plan-check-body">
        <p>Advisory checks. Review the plan before acting on it.</p>
        {check.fileCount > 0 && check.pathStatus !== 'ready' && (
          <p role="status">
            {paths?.status === 'loading'
              ? 'Checking file references…'
              : (paths?.statusMessage ??
                `File checks unavailable for ${check.fileCount - check.checkedFileCount} references. Connect the local workspace to check them.`)}
          </p>
        )}
        {check.findings.length > 0 ? (
          <ul>
            {check.findings.map((finding) => (
              <li key={finding.code}>
                {finding.message}
                {finding.paths && (
                  <ul>
                    {finding.paths.map((path) => (
                      <li key={path}>
                        <code>{path}</code>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p>Verification steps and acceptance criteria detected.</p>
        )}
      </div>
    </details>
  );
}
