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

Not yet. The plan proposes `formancy.ai/data`; nothing is live there, and the
*About* field stays empty until something is.

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
