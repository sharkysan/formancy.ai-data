# Releasing

Releases are cut by [`.github/workflows/release.yml`](.github/workflows/release.yml)
and nowhere else. A release built on a laptop cannot carry provenance — the
attestation is a statement *by GitHub* about which workflow, at which commit,
produced a tarball, and only the workflow can make it.

## Cutting one

```bash
# 1. Bump every package to the new version (one number across all of them)
node scripts/bump.mjs 0.1.0

# 2. Rename "## Unreleased" in CHANGELOG.md to the version's heading, and say
#    what is knowingly missing. The release report names the upstream
#    @formancy/* versions the release was tested with; the changelog need not.

# 2b. Whether docs/performance.md still describes what ships (0034). If this
#     names a difference, stop everything else on the machine -- the demo,
#     other containers -- run `pnpm performance`, and commit
#     docs/performance/results.json and the page it rendered
node scripts/performance-stale.mjs

# 3. Verify locally — the workflow runs these again, but finding out here is cheaper
pnpm build && pnpm typecheck && pnpm test:coverage && pnpm check:pkg && pnpm test:repo
node scripts/verify-licenses.mjs
pnpm test:getting-started   # docs/getting-started.md as written; needs Docker, not the build

# 4. Get the release commit onto main, through a pull request like any other.

# 5. Rehearse on it, then read the run's report and the body in its summary.
gh workflow run release.yml --ref main

# 6. Tag that commit and push the tag, and nothing else.
git tag -a v0.1.0 -m "Formancy Data 0.1.0"
git push origin v0.1.0
```

Pushing the tag is what starts the release. Everything after that is the
workflow's job.

## What the workflow does

In this order
([0035](docs/decisions/0035-a-release-report-is-derived-from-the-run-that-gated-it.md)),
so that every check on what would be published runs before anything that
cannot be taken back:

1. **`tag`: decides once whether this run publishes** — only on the push of a
   `v*` tag — and refuses a tag that disagrees with the manifests. A tag
   saying `v0.2.0` on a tree saying `0.1.0` would publish the wrong version
   under the right name, which cannot be fixed afterwards.
2. **`npm-token`: the token must work, beside the gates.** Set, accepted by
   `npm whoami`, and a warning when the account wants a one-time password on
   writes. A missing or refused token is red while the gates are still
   running, not after them.
3. **`gates`: the gates CI runs, from
   [`gates.yml`](.github/workflows/gates.yml)** — build, types, packaging,
   licences and the repository guards; each package's suite on a runner of
   its own, against both databases; the browser gates; the install gate,
   which packs, installs and runs the tarballs and keeps them; the server
   image; and [`docs/getting-started.md`](docs/getting-started.md) as written,
   from a clean checkout, once with the runner's Compose and once with the
   oldest the guide names
   ([0032](docs/decisions/0032-a-clean-install-is-the-composed-stack-and-ci-runs-its-guide.md)).
   Unlike CI, a release restores no Actions cache: a tag's run may restore
   one a main-branch run saved, and every job installs from the registry
   against the lockfile instead. Its last job builds [the release report](docs/release/README.md) of this
   run, and the release body — the version's changelog section and the
   report's summary — and fails when the body has no section or is longer
   than the 125,000 characters GitHub accepts.
4. **`check`, in a job that holds `contents: read` and no secret:** first
   **refuses a release whose measured code, runtime dependencies or build
   inputs differ from what the published performance figures were measured
   on**: it runs `node scripts/performance-stale.mjs` after the install and
   without a build, and fails naming each difference
   ([0034](docs/decisions/0034-performance-is-measured-through-the-shipped-server-and-held-without-a-clock.md));
   step 2b above is the same check, run where the re-measurement can happen,
   and `scripts/performance-stale.test.mjs` fails when `publish` stops
   waiting for it. Then it refuses a report with any problem, a partial or local one, or one of another
   commit, run, release or version; tarballs that are not, byte for byte, the
   install gate's, one per published package, each at the release's version;
   a tarball without `LICENSE.md` and `NOTICE` or with the wrong licence
   field; and a missing or overlong body. Then it pins what it checked, the
   sha256 of every file of the report and of every tarball, as its outputs,
   and only then generates a CycloneDX SBOM, refusing one without either
   driver, or naming a version of any runtime dependency -- tedious under
   mssql included -- or of upstream other than the suites loaded, and pins
   that too. It is not a job that can write nothing: every job of a run can
   write to the run's artefacts, this one uploads the SBOM, and cdxgen's own
   dependencies are not locked; the pins are what tie what is published to
   what was checked.
5. **`publish`, only on a tag, the one job with write permissions and an OIDC
   identity:** first refuses any file it downloaded that `check` did not pin
   or pinned otherwise, and a report that is not this run's, green and whole
   -- before signing anything, and again in the step that holds the npm
   token; then signs the SBOM and the report with cosign, keylessly; builds,
   pushes and signs the server image and attaches the SBOM to it; publishes
   the tarballs `check` passed to npm with provenance, in dependency order;
   and creates the GitHub release with the SBOM, the report and their
   signatures attached. No step in it carries a condition of its own: the
   job is the boundary.

`--access public` is about the registry's visibility of a scoped package;
`LICENSE.md` is what says what may be done with it.

The server image is built by this workflow at the tagged commit, pushed to
`ghcr.io/<owner>/formancy-data-server:<tag>` with build provenance, signed with
cosign **by digest**, and carries the SBOM as an attestation. There is no
`latest` tag. The gates build the same image on every pull request and prove it
starts, refuses when unconfigured, runs unprivileged, can write its store's
directory, and reads `FORMANCY_DATA_RATE_LIMIT`: a limit of 2 answers the
third request 429, and a value that is not a whole number stops it. The
report labels that one as the gate's image, never as the published one.

The composed stack's web image -- nginx with the studio and the host page,
`formancy/data-web:compose` -- is never released. Compose builds it from the
checkout on the operator's machine, and no workflow pushes it: the studio is
private ([0024](docs/decisions/0024-the-studio-speaks-only-the-admin-plane.md))
and the host page an example. That is held by review; nothing fails if a
workflow did push it. The server image compose builds is tagged
`formancy/data-server:compose`, never the released name.

## Rehearsing

`gh workflow run release.yml --ref <branch>`, or **Run workflow** on the
Actions page, runs `tag`, `gates` and `check` on that branch: every gate, the
report, the release body, the SBOM and every check on the tarballs, exactly as
a tag would. It skips `npm-token` and `publish`, so it needs no secret and
cannot publish, sign or push; its jobs hold `contents: read` and nothing
else. Its report and body name the release `dry-run`, and its body uses the
version's changelog section when there is one and `Unreleased` otherwise, so
a rehearsal on the release commit renders the body that will be released.

Agents ask before dispatching it, and never tag or publish.

## If a step after npm fails

Only the GitHub release comes after npm. Run the failed `publish` job again: it signs and pushes the image again,
`publish.mjs` skips every version npm already holds with the same bytes and
refuses one npm holds with other bytes, and the release is created. Signatures
are logged in Rekor before npm is reached, and those entries stay even when a
release never happens.

| Step | What cannot be taken back | Can fail on | Already done when it fails |
|---|---|---|---|
| `sign-sbom`, `sign-report` | Rekor log entries | Sigstore | nothing published |
| `image`, `sign-image`, `attest-sbom` | an image tag in GHCR (deletable) and Rekor entries | the registry; a moved base tag breaking a build the container gate passed earlier in the run; Sigstore | signatures only |
| `npm-publish` | each version number on npm, forever | the registry; any one of the packages | signatures and the image |
| `github-release` | nothing: a release can be edited or deleted | the GitHub API | npm and the image |

The publish job has never run. A test holds its shape
(`scripts/release-report/workflows.test.mjs`); the first tag is the first
time it runs.

## Provenance

`npm publish --provenance` under `id-token: write` makes npm record a
[sigstore](https://www.sigstore.dev/) attestation binding each tarball to the
workflow run, the commit and the repository that built it. Anyone can check it:

```bash
npm audit signatures
```

**Requirements**: the repository is public, every manifest carries a
`repository` field matching it, and publishing happens from GitHub Actions.

## Secrets

`NPM_TOKEN` must be an Automation or Granular Access token. A classic token on
an account that enforces 2FA on writes demands a one-time password at publish
time, and the `npm-token` job checks for that beside the gates. A rehearsal
does not read it.

It is a secret of the `npm` environment, not of the repository: the two jobs
that read it, `npm-token` and `publish`, name that environment, and its
deployment policy admits only `v*` tags, so a workflow pushed to any other
branch or tag cannot read it. A repository secret could be read by a workflow
on any branch a collaborator pushes. The environment and its policy are
repository settings ([REPO-METADATA.md](.github/REPO-METADATA.md)); that the
jobs name the environment is held by
`scripts/release-report/workflows.test.mjs`, and that the policy is set is
held by nothing here.
