<!-- Part of Formancy Data: https://github.com/sharkysan/formancy.ai-data -->

# @formancy/data-core

The database-neutral core of Formancy Data: the port every database adapter
implements, and what the adapters have to agree on so that the rest of the
product never needs to know which database it is talking to.

**No driver, no HTTP, no Node.** The package compiles against `ES2023` with no
`@types/node`, so a Node import here is a compile error rather than a review
finding — the same rule `@formancy/core` holds upstream, for the same reason: a
core that can only run on a server is a core that cannot be checked in a
browser.

## What is here today

The adapter port, and nothing that generates a form yet:

```ts
import type { DatabaseAdapter } from '@formancy/data-core'
import { DATABASE_KINDS, isDatabaseKind } from '@formancy/data-core'
```

`DatabaseAdapter` has two implementations from the first day —
`@formancy/data-postgres` and `@formancy/data-sqlserver` — which is what makes
it a port rather than an interface with one implementation.

## Licence

Source-available, not open source. See [`LICENSE.md`](./LICENSE.md): free to
read, fork, evaluate, develop and test; a paid licence for production use.
