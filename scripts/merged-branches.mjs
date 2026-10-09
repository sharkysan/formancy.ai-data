import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Whether GitHub deletes a pull request's branch when it merges (0036), from
 * the repository as `GET /repos/{owner}/{repo}` answers it.
 *
 * A field the answer leaves out is a refusal, not a pass: GitHub omits the
 * merge settings for a token that may not see them, and a check that read
 * that as "on" would pass for every such token.
 */
export function mergedBranchProblems(repository) {
  if (repository === null || typeof repository !== 'object' || typeof repository.full_name !== 'string') {
    return ['the answer is not a repository; was the request refused?']
  }
  const name = repository.full_name
  if (!('delete_branch_on_merge' in repository)) {
    return [`${name}: the answer does not say whether a merged branch is deleted (delete_branch_on_merge); the token may not see the repository's merge settings`]
  }
  if (repository.delete_branch_on_merge !== true) {
    return [`${name}: delete_branch_on_merge is off, so a merged branch stays on GitHub; turn on "Automatically delete head branches" (0036)`]
  }
  return []
}

// `gh api repos/<owner>/<repo> | node scripts/merged-branches.mjs`, in CI's verify job.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let repository
  try {
    repository = JSON.parse(readFileSync(0, 'utf8'))
  } catch {
    repository = null
  }
  const problems = mergedBranchProblems(repository)
  for (const problem of problems) console.error(problem)
  process.exit(problems.length === 0 ? 0 : 1)
}
