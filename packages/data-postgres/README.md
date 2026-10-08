<!-- Part of Formancy Data: https://github.com/sharkysan/formancy.ai-data -->

# @formancy/data-postgres

The PostgreSQL adapter for Formancy Data, behind the port
`@formancy/data-core` defines. Built on [`postgres`](https://github.com/porsager/postgres),
the same driver `@formancy/server` uses upstream.

## What is here today

An adapter that reaches a real server and says which version answered:

```ts
import postgres from 'postgres'
import { createPostgresAdapter } from '@formancy/data-postgres'

const adapter = createPostgresAdapter(postgres(process.env.DATABASE_URL))
await adapter.ping() // { kind: 'postgres', version: '17.6' }
await adapter.close()
```

The adapter takes a connected driver rather than a connection string: opening
the connection is where a secret is handled, and that happens once, in the
composition root. Nothing in this package reads configuration.

## Tests

`pnpm test` starts `postgres:17-alpine` through testcontainers and runs the
suite against it. It needs Docker, and there is no mocked driver to fall back
to — database semantics are what this package is for, and a suite that passed
without a database would be proving the mock (0003).

## Licence

Source-available, not open source. See [`LICENSE.md`](./LICENSE.md).
