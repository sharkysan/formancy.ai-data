# 0036 — A merged branch is deleted by the merge, and only by the merge

- **Status:** accepted
- **Date:** 2026-10-09
- **Deciders:** Daniel Bacher
- **Verified by:** the repository setting *Automatically delete head
  branches* (`delete_branch_on_merge`), read on every pull request by CI's
  `verify` job through `scripts/merged-branches.mjs`, which fails when the
  setting is off or the answer does not say;
  `scripts/merged-branches.test.mjs` in `pnpm test:repo` holds both refusals
  on fixtures, and the script was watched refusing a repository with the
  setting off before the setting was relied on. A local branch or worktree
  left on somebody's machine after a merge is held by nothing but the
  sentence in `CLAUDE.md`.

## Context

Every change here arrives as a pull request from a branch of its own and is
squash-merged, so a merged branch carries nothing `main` does not. Until
2026-10-09 the repository kept head branches after a merge, and each was
deleted by hand once the merge was done. That is a step somebody remembers,
and the time it went wrong it went wrong the other way: a merge that failed
on a network timeout had its branch deleted after it anyway, which closed the
pull request. The lesson written down then was "confirm the pull request says
MERGED before deleting either branch", which is a second step to remember.

Branches and worktrees that outlive their merge also stop the branch list from
saying what is in flight: two branches of that day were left with worktrees on
one machine and no commits, and a later session could not tell finished work
from abandoned work.

## Decision

GitHub deletes a pull request's head branch when the pull request merges —
the repository setting is on, and CI fails while it is off. Nobody deletes a
remote branch by hand after a merge. A local branch and its worktree are
removed once `gh pr view N --json state` says `MERGED`, never before.

## Consequences

**What it buys.** No branch on GitHub outlives its merge, and the deletion is
conditional on the merge by construction: a pull request that did not merge
keeps its branch, whatever a script did next. The pull request page keeps a
*Restore branch* button for the rare follow-up that wants it back.

**What it costs.** A branch somebody meant to keep working on after the merge
is gone from GitHub and has to be cut again from `main`, which is what
[`CLAUDE.md`](../../CLAUDE.md) asks for anyway (no stacked pull requests). The
`verify` job now asks GitHub's API on every pull request, so an outage of that
API fails the job, and the check rests on the job's read-only token being
allowed to see the repository's merge settings; if GitHub stops showing them
to that token, the job fails rather than passing, and this record has to be
revisited. It checks the setting, not the deletions: a branch pushed again
after its merge is not caught.

**What it forecloses.** Long-lived branches on GitHub other than `main`. None
exist, and a release is cut from a tag, not a branch.

## Alternatives considered

**Delete by hand after confirming the merge.** The practice this replaces:
rejected because it is a step somebody remembers, and the one recorded
failure was that step running when it should not have.

**A scheduled workflow that prunes merged branches.** Rejected: it needs
`contents: write` in a workflow, which this repository's workflows refuse, and
it acts after the fact on a list it has to compute.

**Keep merged branches.** Rejected: the branch list stops saying what is in
flight, which is what it is read for.
