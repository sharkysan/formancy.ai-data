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

# 4. Commit, tag, push
git commit -am "Release 0.1.0"
git tag -a v0.1.0 -m "Formancy Data 0.1.0"
git push origin main --follow-tags
```

Pushing the tag is what starts the release. Everything after that is the
workflow's job.

## What the workflow does

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
starts, refuses when unconfigured, and runs unprivileged.

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
