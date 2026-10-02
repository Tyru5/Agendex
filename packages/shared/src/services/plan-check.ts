import { dirname } from 'node:path';
import { candidatePathsForValidation, extractCandidateCodePaths } from '../plan-paths.ts';
import { checkPlan, type PlanCheck } from '../plan-check.ts';
import type { Plan } from '../types.ts';
import {
  isWithinWorkspace,
  PATH_EXISTS_BATCH_LIMIT,
  resolveCodeFileBatch,
} from './path-resolve.ts';

export async function getPlanCheck(plan: Plan): Promise<PlanCheck> {
  const paths = candidatePathsForValidation(extractCandidateCodePaths(plan.content));
  const parent = dirname(plan.filePath);
  const baseDir = plan.workspace && isWithinWorkspace(parent, plan.workspace) ? parent : undefined;
  const results: Parameters<typeof checkPlan>[1] = {};
  for (let offset = 0; offset < paths.length; offset += PATH_EXISTS_BATCH_LIMIT) {
    Object.assign(
      results,
      await resolveCodeFileBatch(
        paths.slice(offset, offset + PATH_EXISTS_BATCH_LIMIT),
        plan.workspace,
        baseDir,
      ),
    );
  }
  return checkPlan(plan, results);
}
