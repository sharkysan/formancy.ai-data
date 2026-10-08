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

- **The adapter port**, `DatabaseAdapter`, with two implementations from the
  first day.
- **The metadata contract**: `MetadataSnapshot` and what it holds, made only
  through `createSnapshot`, which sorts, checks and fingerprints. A snapshot
  carries **gaps** — what the connection could not see — so a
  permission-filtered catalog is never mistaken for a complete one.
- **Form generation**: `generateForm(snapshot, request)` returns a spec 3
  formancy document, its `FormBindings`, and a note on every choice it made.
- **Codecs**: `codecFor(column)` checks and canonicalises one API value for a
  column — decimals as strings, never rounded; integers past 2^53 as strings;
  formancy's date and time shapes on real days
  ([0008](../../docs/decisions/0008-exact-values-travel-as-strings.md)).

```ts
import { generateForm } from '@formancy/data-core'

const { form, bindings, notes } = generateForm(snapshot, {
  connection: 'erp',
  root: { schema: 'sales', name: 'order' },
  formId: 'sales-order',
  title: 'Order',
  lookups: [{ foreignKey: 'fk_order_customer', display: ['name'] }],
})
```

Exact decimals and integers past 2^53 become text fields with an exact pattern,
never JavaScript numbers. Update is offered only with a proven concurrency
token. See [0009](../../docs/decisions/0009-generation-is-deterministic-and-says-what-it-chose.md).

## Licence

Source-available, not open source. See [`LICENSE.md`](./LICENSE.md): free to
read, fork, evaluate, develop and test; a paid licence for production use.
