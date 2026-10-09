# Releasing

Releases are cut by [`.github/workflows/release.yml`](.github/workflows/release.yml)
and nowhere else. A release built on a laptop cannot carry provenance — the
attestation is a statement *by GitHub* about which workflow, at which commit,
produced a tarball, and only the workflow can make it.

## Cutting one

```bash
# 1. Bump every package to the new version (one number across all of them)
node scripts/bump.mjs 0.1.0

# 2. Write the entry in CHANGELOG.md, including what is knowingly missing,
#    and which upstream @formancy/* versions this release was built against

# 3. Verify locally — the workflow runs these again, but finding out here is cheaper
pnpm build && pnpm typecheck && pnpm test && pnpm check:pkg && pnpm test:repo
node scripts/verify-licenses.mjs
pnpm test:getting-started   # docs/getting-started.md as written; needs Docker, not the build

# 4. Commit, tag, push
git commit -am "Release 0.1.0"
git tag -a v0.1.0 -m "Formancy Data 0.1.0"
git push origin main --follow-tags
```

Pushing the tag is what starts the release. Everything after that is the
workflow's job.

## What the workflow does

Before anything is built for publishing, the `getting-started` job runs
[`docs/getting-started.md`](docs/getting-started.md) at the tagged commit, as
CI does on every pull request: the guide's own commands from a clean checkout
with Node and Docker alone, once with the runner's Compose and once with the
oldest release the guide names, then the journey it describes over HTTP on
both engines, failing if a secret or a token reaches a log. The `release` job
`needs` it, so a release whose clean install does not work is not cut
([0032](docs/decisions/0032-a-clean-install-is-the-composed-stack-and-ci-runs-its-guide.md)).
Then:

1. **Refuses a tag that disagrees with the manifests.** A tag saying `v0.2.0`
   on a tree saying `0.1.0` would publish the wrong version under the right
   name, which cannot be fixed afterwards.
2. **Runs the full gate** — build, typecheck, test against both databases,
   `check:pkg`, the repository guards. A release must not be the first time
   these run against this tree.
3. **Refuses to publish a tarball without its licence**, or one whose manifest
   declares the wrong one.
4. **Publishes to npm with provenance.** `--access public` is about the
   registry's visibility of a scoped package; `LICENSE.md` is what says what
   may be done with it.
5. **Generates a CycloneDX SBOM** and refuses to continue if either database
   driver is missing from it.
6. **Signs the SBOM with cosign**, keylessly.
7. **Creates the GitHub release** with both attached.

The server image is built by this workflow at the tagged commit, pushed to
`ghcr.io/<owner>/formancy-data-server:<tag>` with build provenance, signed with
cosign **by digest**, and carries the SBOM as an attestation. There is no
`latest` tag. CI builds the same image on every pull request and proves it
starts, refuses when unconfigured, runs unprivileged, and can write its
store's directory.

The composed stack's web image -- nginx with the studio and the host page,
`formancy/data-web:compose` -- is never released. Compose builds it from the
checkout on the operator's machine, and no workflow pushes it: the studio is
private ([0024](docs/decisions/0024-the-studio-speaks-only-the-admin-plane.md))
and the host page an example. That is held by review; nothing fails if a
workflow did push it. The server image compose builds is tagged
`formancy/data-server:compose`, never the released name.

## Provenance

`pnpm publish --provenance` under `id-token: write` makes npm record a
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
time, and the workflow checks for that before it builds anything.
