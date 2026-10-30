# 0116 — Every TypeScript and JavaScript file is linted and formatted by the rules the four formancy repositories share, a copy of Formancy Health's until formancy.ai publishes them, and `verify` fails a change that breaks either; the change merges with a merge commit, so that blame can skip the format

- **Status:** accepted; narrows [0002](0002-depend-on-upstream-never-copy-it.md): its wait for a release, for the lint and format rules, which are a byte-for-byte copy of Formancy Health's until formancy.ai releases them as `@formancy/code-style`, and go when this repository pins it
- **Date:** 2026-10-30
- **Deciders:** Daniel Bacher
- **Verified by:** the guards and `verify`'s two steps, on 30 October 2026,
  each watched failing first, every file a fault was planted in put back
  byte for byte:
  - **`scripts/code-style/code-style.test.mjs`** (`pnpm test:repo`) -- the
    shared rules, on a repository of real files it writes under the
    system's temporary directory: what each rule and each path does.
    Copied with the module from Formancy Health, where each case was
    watched failing
    ([formancy.ai-health 0017](https://github.com/sharkysan/formancy.ai-health/blob/main/docs/decisions/0017-every-typescript-and-javascript-file-is-linted-by-the-recommended-type-aware-rules-and-formatted-by-prettier.md)
    says how).
  - **`scripts/lint.test.mjs`** (`pnpm test:repo`) -- this repository's
    wiring, derived from the files git holds: every TypeScript and
    JavaScript file linted by `pnpm lint` as `eslint .`, by the rules its
    kind is held to and none at `warn`, and resolving to the shared style;
    the format scripts naming a misformatted file of every extension git
    holds; a source file of every package and app, and every file
    `tsconfig.tools.json` takes in, linted with its own content and with
    no message (watched failing with a needless assertion planted in
    `vitest.results.ts`); and, Data's own, every TypeScript file git holds
    in a program lint types it with (watched failing with
    `apps/host/src/duplicate.test.tsx`, which TypeScript's `include`
    dropped beside `duplicate.test.ts`, and with
    `scripts/getting-started/walk.d.mts`, which no tsconfig named). Like
    Health's, it never hands ESLint a text other than a file's own, and
    lints each file once: on CI, where `CI=true`, typescript-eslint infers
    a single run, so a text for a path on disk is typed as the file on disk
    and a file linted twice gives no findings the second time
    (formancy.ai-health 0017).
  - **`verify`'s `pnpm lint` and `pnpm format:check`**, on every pull
    request and before a release publishes. With `Promise.resolve()`
    planted as a statement at the end of
    `packages/data-core/src/records/heading.ts`, `pnpm lint` exited 1,
    naming `@typescript-eslint/no-floating-promises` at that line; with
    `export const planted = "x"` planted there instead,
    `pnpm format:check` exited 1, naming the file.
  - **`scripts/release-report/workflows.test.mjs`**, its case `verify runs
    the linter and the formatter’s check after the typecheck` -- both
    steps in `verify`, after the build and the typecheck and before the
    guards. Watched failing before `gates.yml` ran them (`pnpm lint:
    expected -1 to be greater than 7`), with `pnpm lint` moved before the
    typecheck, and with the build step renamed, which a step not found
    would otherwise pass.
  - **`scripts/prettier-merge.test.mjs`** (`pnpm test:repo`) -- the merge
    across the format, run as CONTRIBUTING.md runs it, in a repository of
    its own: a change on one side, against main's format of the same
    lines, merges without a conflict and comes in formatted, where git's
    own merge of the same three versions conflicts; a change of what a
    line says on both sides still conflicts; and a side Prettier cannot
    parse merges unformatted, as a conflict that keeps both sides whole,
    with a line saying so. Watched failing with the driver formatting
    nothing (the first two), with `git merge-file --union` keeping both
    sides of a conflict (the second), with the attributes naming
    JavaScript alone (the first two), and with the fallback removed (the
    third).

  **Measured** on 30 October 2026, once each, after `pnpm build`, on an
  Apple M2 with 8 cores and 16 GB under macOS 26.5.2, with Node 22.23.3
  and pnpm 12.4.2, while other work ran (a load average of 4.0): over
  the 942 TypeScript and JavaScript files of the tree with this change,
  `pnpm lint` took 30.8 s of wall time, and `pnpm format:check` 7.1 s.
  Not measured on CI's runner.

  **Not mechanically enforced:** how the pull request that brings this
  merges, which GitHub leaves to the person merging; that a disable
  comment's reason is true; and that `scripts/code-style/` is Formancy
  Health's, or the rules formancy.ai publishes, which nothing compares.

## Context

This repository had no linter and no formatter, and neither had
formancy.ai, Formancy Health or Formancy Report. Style was held by habit
and review, and the mistakes only a type-aware linter sees by nobody. The
maintainer asked on 30 October 2026 for a linter and a formatter in all
four repositories, of the same quality. Formancy Health went first, with
the fewest findings and no open pull request, and wrote the rules as one
module shaped as the package formancy.ai will publish,
`scripts/code-style/code-style.mjs`
([formancy.ai-health 0017](https://github.com/sharkysan/formancy.ai-health/blob/main/docs/decisions/0017-every-typescript-and-javascript-file-is-linted-by-the-recommended-type-aware-rules-and-formatted-by-prettier.md)).
This repository is the second.

What was here differed from Health's in four ways that the decision
answers. The code is larger: with this repository's paths, as first
committed on 30 October 2026, the shared rules reported 323 findings.
Five files would have passed the 600-line budget once formatted at 160
columns, measured that day with Prettier 3.9.10: `apps/host/src/form-view.tsx`,
`apps/host/src/test-plane.ts`, `packages/data-fixtures/src/drifting.ts`,
`packages/data-server/src/routes/runtime.ts` and
`scripts/release-report/render.mjs`. Many suites need Docker: every
`*.integration.test.ts`, and every file of `data-client` and `apps/host`,
which start both databases in a global setup (0003), and Docker did not
run on the machine the change was made on. And branches here are many and
short: main took eight pull requests, #131 to #137 and #139, on 30
October 2026 while this was open, and each came into this branch
unformatted.

## Decision

- **The shared rules, with this repository's paths.** `eslint.config.mjs`
  calls `eslintConfig` from `scripts/code-style/code-style.mjs`, and
  `prettier.config.mjs` exports its `prettierConfig`. The directory, the
  module and its test, is Formancy Health's at `4f151a2`, byte for byte.
  The rules, the seven relaxations in a test, `require-await` off in
  every file, the style, TypeScript and JavaScript alone, the ignores and
  why each is so are formancy.ai-health 0017's and are not restated here.
  A rule this repository needed beyond them -- a rejection that forwards
  an `unknown`, an `any` in a test -- went into Health's module first and
  was copied, so the copies stay one set of rules.
- **This repository's paths**, held by `scripts/lint.test.mjs`:
  - `project`, the tsconfigs lint types with: `./packages/*/tsconfig.json`
    and `./apps/*/tsconfig.json` by glob, so a new package or app is
    linted with types without an edit; `data-client`'s
    `tsconfig.test.json`, since its `tsconfig.json` builds the source
    alone, without Node's types; `apps/live-demo`'s
    `tsconfig.worker.json`, which holds the Worker its `tsconfig.json`
    leaves out; and `tsconfig.tools.json`, which brings the vitest, Vite
    and tsdown configs and `scripts/getting-started/walk.d.mts` into
    `pnpm typecheck`, `allowJs` for the Vite configs that import
    `scripts/third-party-notices.mjs`.
  - `untyped`: `scripts/install-fixture/**`, which imports the packed
    tarballs the workspace does not resolve; the install gate type-checks
    it.
  - `browser`: `apps/*/scripts/**`, `scripts/pictures/**` and
    `scripts/browser-gate.mjs`, the scripts that drive Playwright, whose
    `page.evaluate` callbacks run in a page: found by `no-undef`, which
    fired in them and nowhere else without the page's globals.
  - `react`: the examples page, the studio and the host page.
  - `apps/host/tsconfig.json` names `src/duplicate.test.tsx` in `files`:
    beside `duplicate.test.ts`, TypeScript's `include` took the `.ts`
    alone, so the `.tsx` was neither type-checked nor linted.
- **Five files split before the format**, each by the reason it changes,
  in a commit of its own that moves code without changing what it does --
  the write routes take as steps what they read from the plane they left,
  as the other `runtime-*.ts` routes do: the open form's
  header into `form-head.tsx` (053a6f1); the test network's held and lost
  answers into `test-network.ts` (87ff284); the drift cases whose verdict
  is the adapters' alone into `drifting-definition.ts`, with the tables
  both case files build in `drifting-tables.ts` (1ed2882); a record's
  create and update into `routes/runtime-writes.ts` (b1d5cb2); and the
  release report's derived limitations into `derived-limitations.mjs`,
  with what both renderers write in `markdown.mjs` (ceefe1d). The drift
  fixtures and the release report were compared before and after each
  move, byte for byte but for the report's line naming the new file.
- **Every finding fixed.** A disable comment is for a finding that is
  deliberate, and says why after `--`. Two of the findings were defects,
  each fixed with tests that failed against the code before the fix:
  - the host page named a field whose label is a `{ $t }` message
    reference "[object Object]" in its grid's columns, its filter panel,
    a child's title and Duplicate record's line (01cf13a), and so did a
    tree of records' line for a level that holds none, which main brought
    while this was open -- what a page or a file calls a field is now one
    function, data-core's `fieldHeading`, re-exported by data-client,
    which the CSV export, the host page and the examples page call;
  - `createSnapshot` refused a server fact, or an inbound key's
    referenced column, given as an object as "[object Object]"
    (`snapshot.ts`'s `shown`, over several commits). An object is now
    written as JSON, a bigint inside it as its digits, and one JSON cannot
    write, a cycle, by its tag. The branch's first fix wrote every value as
    JSON, which threw on a bigint and wrote NaN as "null"; a primitive is
    written as `String` writes it, as on main, and the tests hold both.
- **The gate:** `verify` runs `pnpm lint` and `pnpm format:check` after the
  build and the typecheck, and before the guards. In `verify` rather than a
  job of its own, which would need a collect step, an upload and a reader
  in the release report
  ([0035](0035-a-release-report-is-derived-from-the-run-that-gated-it.md)).
- **The format commits, merged as they are.** The format is one commit of
  Prettier's output and nothing else; main was merged into the branch
  three times while it was open, and what it brought unformatted was
  formatted in a commit of Prettier's output after each merge.
  `.git-blame-ignore-revs` names those commits by their SHAs, each under a
  line saying what it formatted. **The pull request that brings this
  merges with "Create a merge commit", never a squash or a rebase**: a
  squash folds the format into one commit with everything else, a rebase
  gives each commit another SHA, and either way the file names nothing on
  `main`.
- **A merge across the format.** `scripts/prettier-merge.mjs` runs
  `git merge` with a merge driver, for that command alone, on every
  extension the shared style formats: the driver formats the common
  ancestor, ours and theirs in this repository's style, until Prettier
  stops changing them, then `git merge-file` merges the three. A line the
  format rewrote conflicts only where both sides changed what it says.
  Prettier and the style are the script's own checkout's, so a branch
  begun before the format, which has neither, runs it from a checkout of
  main, as CONTRIBUTING.md says. This branch took main three times
  through the same driver: of the files both sides had changed, 72 of 76
  merged clean the first time, where `git merge-file` on the same
  unformatted versions conflicted in 38, 17 of 19 the second, where it
  conflicted in 9, and 36 of 37 the third, where it conflicted in 8.
- **A copy until formancy.ai releases.** The swap is a pull request of its
  own, as Formancy Health's is: the package pinned exactly as a root
  devDependency, `scripts/code-style/` deleted, the two config files
  importing the package, and `scripts/upstream-deps.mjs` extended to the
  root manifest, which holds no `@formancy/*` dependency until then. Until
  the swap, a rule is changed in Formancy Health's module first and copied
  here, never changed here alone.

## Consequences

**What it buys.** A promise nobody awaits, an `any` from a parse in a
package's source, an assertion of a type already known, a name nobody
uses, a mistyped global in a script, and an object printed as "[object
Object]" fail the pull request that brings them. The style is a check and
not a habit, and the same in the four repositories.

**What it costs.**
- **Blame.** The format rewrote 638 files, 25,448 lines added and 6,973
  removed; the three later format commits 9, 6 and 13 files. GitHub's
  blame skips them by `.git-blame-ignore-revs`; `git blame` only with
  `--ignore-revs-file` or `blame.ignoreRevsFile` set; and `git log -S` and
  `-L` see them, as does any tool that reads neither.
- **Every branch open under the format conflicts with it.** Through
  `scripts/prettier-merge.mjs` most of those conflicts go, but not all: a
  line both sides changed is still a conflict, a file only the branch
  changed comes in as it was written, for `pnpm format` after the merge,
  code main moved to another file is carried across by hand, since the
  driver merges a file with itself, and the script needs a checkout of
  main at least as new as the main it merges, its dependencies
  installed.
- **A copy that can drift.** Until the swap, nothing compares
  `scripts/code-style/` with Formancy Health's or with formancy.ai's
  package, and a change to one reaches the others by hand alone.
- **Typed lint's time**, inside `verify`'s 15 minutes: 30.8 s on the Mac
  above, not measured on CI's runner; and `lint.test.mjs`'s typed cases
  wait up to 60 s, for programs measured at 16.8 s with the file run alone
  and 18.4 s inside `pnpm test:repo` (Apple M2, 30 October 2026).
- **`require-await` is off everywhere.** A function marked `async` that
  awaits nothing passes the linter in source and in tests, so one an
  edit left behind is found by review alone; `no-floating-promises` and
  `no-misused-promises` still catch a forgotten `await`. The reason, and
  what it was measured to cost, is formancy.ai-health 0017's.
- **The relaxations hide an `any` in a test.** A test may read a member a
  value does not have and pass the linter; tsc holds what is typed, and
  nothing holds what is not.
- **TypeScript's ceiling, twice.** typescript-eslint 8.72.1 admits
  TypeScript below 6.1.0, and `.npmrc` refuses an unmet peer
  (`strict-peer-dependencies`), so a move to 6.1 waits for it as it waits
  for formancy.ai's Angular 22, the catalog's reason for `~6.0.3`.
- **A Prettier release is a reformat**, one more commit for blame to skip.
- **A disable comment's reason** is review's to read: the rule checks only
  that there is one.
- **What only CI ran.** The splits and the fixes reached files whose
  suites start containers -- `apps/host`, `data-client` and every
  `*.integration.test.ts` -- and Docker did not run where they were made.
  There the gates ran, with the suites of data-core, data-identity, the
  examples page and the studio, every other file of the packages, and the
  host's and the client's files that need no database, through a
  configuration without the databases; CI's `test` jobs ran the rest.
- **The merge method is remembered, not held.** The repository allows a
  squash, a rebase and a merge commit, and nothing refuses the first two.

**What it forecloses.** A rule at `warn`; a style decided file by file;
a rule changed in this repository alone; and, for the pull request that
brings this, a squash or a rebase.

## Alternatives considered

**Biome, no linter, linting per package through turbo, warnings, 120
columns, every kind of file formatted, `allowDefaultProject` for the tool
configs, and a hook before each commit.** Each rejected in
formancy.ai-health 0017, for reasons that hold here: at 160 columns the
format rewrote the fewest lines there of the widths measured, and one
width across the four repositories is the point.

**A width or a budget that spared the five files.** Rejected: the budget
is CLAUDE.md's and is never raised, and a width of this repository's own
would make it the one repository formatted differently. Each file was
split where it already had two reasons to change.

**Rebasing the branch on main instead of merging main into it.** Rejected:
`.git-blame-ignore-revs` names the format commits by SHA, and a rebase
moves them.

**A merge driver in `.gitattributes`.** Rejected: an attribute names a
driver that each person's git configuration must define, and a branch
begun before the format has neither the attribute nor Prettier. The
script hands git both for one command, from a checkout that has them,
and writes nothing to anybody's configuration.

**Resolving each conflict by hand.** What a branch without the script
does: in this branch's first merge of main, 38 of the 76 files both
sides had changed, against 4 through the driver.

**The shared module changed for this repository.** Rejected: a rule
changed here alone is a fourth set of rules where there is meant to be
one. Both rules this repository's findings asked for went into Formancy
Health's module, a review ruled on 30 October 2026, and this copy took
them from there.

**Waiting for `@formancy/code-style`.** What 0002 asks of anything
upstream does not yet offer. Rejected: the maintainer said on 30 October
2026 not to wait, and the rules had been proved in Formancy Health. The
cost is the copy above.

## Older records

[0002](0002-depend-on-upstream-never-copy-it.md) is not superseded. It
still has this repository depend on what formancy.ai releases, at an exact
version, and copy none of it; this record narrows its wait for a release,
for the lint and format rules alone, and the copy goes when the package is
pinned. It was read again and stamped
(`node scripts/release-report/limitations.mjs --stamp 0002`), its Status
line naming this record.
