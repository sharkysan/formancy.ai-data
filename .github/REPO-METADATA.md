# Repository metadata

Kept here because GitHub's description and topics live in repo settings, not in
the tree. This file is the reviewable source for what should be set there.

## Description

> Turn an existing PostgreSQL or SQL Server database into formancy forms that
> fit your application: discovery, policy-aware lookups and controlled record
> editing. Source-available; free to evaluate and develop, paid in production.

## Topics

```
forms
form-builder
database
postgresql
sql-server
crud
schema-introspection
angular
react
typescript
self-hosted
source-available
formancy
```

## Apply

```bash
gh repo edit sharkysan/formancy.ai-data \
  --description "Turn an existing PostgreSQL or SQL Server database into formancy forms that fit your application: discovery, policy-aware lookups and controlled record editing. Source-available; free to evaluate and develop, paid in production." \
  --add-topic forms --add-topic form-builder --add-topic database \
  --add-topic postgresql --add-topic sql-server --add-topic crud \
  --add-topic schema-introspection --add-topic angular --add-topic react \
  --add-topic typescript --add-topic self-hosted --add-topic source-available \
  --add-topic formancy
```

## Website

Not yet. The plan proposes `formancy.ai/data`, the product's page in
formancy.ai's site; nothing is live there, and the *About* field stays empty
until something is. The examples page's demo at
https://formancy.ai/data/examples/
([0069](../docs/decisions/0069-the-examples-page-is-served-at-formancy-ai-data-examples.md))
is a page below it, not the website.

## The demo's Worker on Cloudflare

The demo is a Cloudflare Worker connected to this repository by Workers
Builds, as formancy.ai's site and formancy.ai-report's Studio are connected
to theirs (0069). Its settings are in Cloudflare's dashboard, under the
Worker's *Settings › Build*, where nothing here can read them.
`scripts/demo.test.mjs` holds the Worker, the root directory, the branch and
the two commands below to `apps/examples/wrangler.json` and
`pnpm demo:deploy`, and every repository and Worker this section names,
the steps included, to data-core's manifest and that config. Review holds
the rest.

| Setting | Value | Why |
|---|---|---|
| Worker | `formancy-data-examples` | The name `apps/examples/wrangler.json` gives it, and the only one `scripts/demo.mjs` deploys to |
| Git repository | `sharkysan/formancy.ai-data` | |
| Production branch | `main` | The demo is main's examples page |
| Builds for non-production branches | off | A branch's build would upload a version of the Worker from code no review has merged |
| Root directory | `/` | The workspace's root, where its lockfile is and `pnpm build` builds every package the page imports |
| Build command | `pnpm build` | |
| Deploy command | `node scripts/demo.mjs` | It stages the build under `/data/examples/` beside its `_headers`, and runs the pinned Wrangler with `apps/examples/wrangler.json` |
| Build variables | none | Node from `.node-version`; pnpm the version `packageManager` names, which the image's pnpm switches to |
| API token | the one Workers Builds generates | No Cloudflare token is held in GitHub |

### Creating the Worker

Once, by the rightsholder, with a Cloudflare account that can edit Workers
on formancy.ai's zone. Until then https://formancy.ai/data/examples/ is
formancy.ai's 404.

In the dashboard alone, which creates the Worker and whose first build
deploys `main`, so it also shows that the deploy on a push works:

1. *dash.cloudflare.com › Workers & Pages › Create › Import a repository ›
   GitHub*. If `sharkysan/formancy.ai-data` is not listed, give the
   Cloudflare Workers and Pages GitHub app access to it: in GitHub,
   *Settings › Applications › Cloudflare Workers and Pages › Configure ›
   Repository access*.
2. Repository: `sharkysan/formancy.ai-data`.
3. The settings in the table: project name `formancy-data-examples`, build
   command `pnpm build`, deploy command `node scripts/demo.mjs`, root
   directory `/`, production branch `main`, no variables.
4. *Create and deploy*.
5. Afterwards, on the Worker, *Settings › Build › Branch control*: builds
   for non-production branches off.

Or with Wrangler first, then connected:

1. `pnpm demo:deploy`, from a clean checkout of `main` after the Wrangler
   login [RELEASING.md](../RELEASING.md#the-demo-on-formancyai) names,
   creates the Worker and its routes and puts the page online at once.
2. Then in the dashboard, *formancy-data-examples › Settings › Build ›
   Connect*, with the same settings, and step 5 above.

Either way, open the address afterwards and press Validate in a preview:
both renderers refuse the empty required fields. And
`curl -sI https://formancy.ai/data/examples/THIRD-PARTY-NOTICES.txt`
should say `Content-Type: text/plain; charset=utf-8`, which shows that
Cloudflare honours the `_headers` file's type (0069). It did when the
demo was live and read by hand on 2026-10-16; nothing here reads it.

## Secrets the workflows expect

| Secret | Used by | Without it |
|---|---|---|
| `CODECOV_TOKEN` | `gates.yml`'s coverage upload, passed by `ci.yml` and never by `release.yml` | The upload step is skipped, visibly; with the token set, a failed upload fails that package's `test` job, as upstream |
| `NPM_TOKEN` | `release.yml`'s `npm-token` and `publish` jobs, on a tag only. A secret of the **`npm` environment**, not of the repository: create the environment with a deployment policy of selected tags, `v*`, and set the secret there, so a workflow pushed to any other branch or tag cannot read it | A tag push is red in `npm-token`, which runs beside the gates rather than after them, and nothing is published; a rehearsal does not need it |

Both jobs that read `NPM_TOKEN` name the `npm` environment, which
`scripts/release-report/workflows.test.mjs` holds. The environment's
deployment policy is a setting of the repository, which no test here can
read: on 2026-10-09 the repository had no environment, and GitHub creates
one with no policy the first time a job names it.
