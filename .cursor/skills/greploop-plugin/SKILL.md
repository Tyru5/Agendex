---
name: greploop-plugin
description: >
  Iteratively improves a PR until Greptile gives it a 5/5 confidence score with zero
  unresolved comments. Triggers Greptile review via the Greptile plugin, fixes all
  actionable comments, pushes, re-triggers review, and repeats. Use when the user
  asks to /greploop-plugin, greploop with the Greptile plugin, resolve Greptile
  comments via plugin re-trigger, or optimize a PR against Greptile review.
---

# Greploop Plugin

Run a /greploop and resolve all comments. You'll have to use the greptile plugin to re-trigger a review

Iteratively fix a PR until Greptile gives a perfect review: 5/5 confidence, zero unresolved comments.

## Requirements

- `git` and `gh` (GitHub CLI) authenticated
- Greptile installed on the repo
- Greptile MCP plugin available (`plugin-greptile-greptile`) for `trigger_code_review`

## Inputs

- **PR number** (optional): If not provided, detect the PR for the current branch.

## Instructions

### 1. Identify the PR

```bash
gh pr view --json number,headRefName,url,baseRefName -q '{number: .number, branch: .headRefName, url: .url, base: .baseRefName}'
gh repo view --json nameWithOwner,defaultBranchRef -q '{repo: .nameWithOwner, defaultBranch: .defaultBranchRef.name}'
```

Switch to the PR branch if not already on it.

### 2. Loop

Repeat the following cycle. **Max 5 iterations** to avoid runaway loops.

#### A. Trigger Greptile review

Push latest changes if needed:

```bash
git push
```

Then **re-trigger the review with the Greptile plugin** (`trigger_code_review` on server `plugin-greptile-greptile`). Do not rely on push alone — always call the plugin:

- `name`: repo full name (e.g. `owner/repo`)
- `remote`: `github`
- `defaultBranch`: repo default branch (e.g. `main`)
- `prNumber`: PR number
- `branch`: PR head branch (optional but preferred)

Poll until the Greptile check completes:

```bash
gh pr checks <PR_NUMBER> --watch
```

Or poll via Greptile MCP `list_code_reviews` / `get_code_review` until status is `COMPLETED` (or `FAILED` / `SKIPPED`).

#### B. Fetch Greptile review results

Prefer Greptile MCP:

- `get_merge_request` — PR metadata, Greptile comments, addressed analysis
- `list_merge_request_comments` with `greptileGenerated: true` — Greptile comments only

Fallback via GitHub API:

```bash
gh api repos/{owner}/{repo}/pulls/<PR_NUMBER>/reviews
gh api repos/{owner}/{repo}/pulls/<PR_NUMBER>/comments
```

Look for the most recent review from `greptile-apps[bot]` or `greptile-apps-staging[bot]`.

Parse for:
- **Confidence score**: e.g. `3/5` or `5/5` in the review summary
- **Unresolved comments**: Greptile inline comments still open on the latest commit

#### C. Check exit conditions

Stop the loop if **any** of these are true:
- Confidence score is **5/5** AND there are **zero unresolved comments**
- Max iterations reached (report current state)

#### D. Fix actionable comments

For each unresolved Greptile comment:

1. Read the file and understand the comment in context.
2. Determine if it's actionable (code change needed) or informational.
3. If actionable, make the fix.
4. If informational or a false positive, note it but still resolve the thread.

#### E. Resolve threads

Fetch unresolved review threads and resolve all that have been addressed (see [GraphQL reference](references/graphql-queries.md)):

```bash
gh api graphql -f query='
query($cursor: String) {
  repository(owner: "OWNER", name: "REPO") {
    pullRequest(number: PR_NUMBER) {
      reviewThreads(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          isResolved
          comments(first: 1) {
            nodes { body path author { login } }
          }
        }
      }
    }
  }
}'
```

Resolve addressed threads:

```bash
gh api graphql -f query='
mutation {
  t1: resolveReviewThread(input: {threadId: "ID1"}) { thread { isResolved } }
  t2: resolveReviewThread(input: {threadId: "ID2"}) { thread { isResolved } }
}'
```

#### F. Commit and push

```bash
git add -A
git commit -m "address greptile review feedback (greploop iteration N)"
git push
```

Then go back to step **A** and **re-trigger via the Greptile plugin** again.

### 3. Report

After exiting the loop, summarize:

| Field | Value |
|-------|-------|
| Iterations | N |
| Final confidence | X/5 |
| Comments resolved | N |
| Remaining comments | N (if any) |

If the loop exited due to max iterations, list any remaining unresolved comments and suggest next steps.

## Output format

```
Greploop complete.
  Iterations:    2
  Confidence:    5/5
  Resolved:      7 comments
  Remaining:     0
```

If not fully resolved:

```
Greploop stopped after 5 iterations.
  Confidence:    4/5
  Resolved:      12 comments
  Remaining:     2

Remaining issues:
  - src/auth.ts:45 — "Consider rate limiting this endpoint"
  - src/db.ts:112 — "Missing index on user_id column"
```
