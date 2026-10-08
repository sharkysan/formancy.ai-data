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
| `CODECOV_TOKEN` | `ci.yml`, coverage upload | The upload step is skipped, visibly; with the token set, a failed upload fails `verify`, as upstream |
| `NPM_TOKEN` | `release.yml` | The release refuses to start, before building anything |
