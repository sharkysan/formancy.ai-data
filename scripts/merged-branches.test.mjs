import { describe, expect, test } from 'vitest'
import { mergedBranchProblems } from './merged-branches.mjs'

describe('mergedBranchProblems', () => {
  // The case 0036 exists for: with the setting off, a merged branch stays on
  // GitHub until somebody deletes it, and a deletion done by hand once ran
  // after a merge that had failed, which closed the pull request.
  test('refuses a repository that keeps head branches after a merge', () => {
    const problems = mergedBranchProblems({ full_name: 'o/r', delete_branch_on_merge: false })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/delete_branch_on_merge is off/)
  })

  // GitHub leaves the field out of the answer for a token that may not see
  // it. A check that passed on a missing field would pass for every token
  // that cannot read the setting, which is a comment, not a gate.
  test('refuses an answer that does not say, rather than reading it as on', () => {
    const problems = mergedBranchProblems({ full_name: 'o/r' })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/does not say/)
  })

  // The answer of a failed request is not a repository.
  test('refuses something that is not a repository', () => {
    expect(mergedBranchProblems({ message: 'Not Found' })).toHaveLength(1)
    expect(mergedBranchProblems(null)).toHaveLength(1)
  })

  test('accepts a repository that deletes head branches when they merge', () => {
    expect(mergedBranchProblems({ full_name: 'o/r', delete_branch_on_merge: true })).toEqual([])
  })
})
