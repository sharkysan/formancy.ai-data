// The snapshot the examples render, captured from a real database.
//
// The previews are generated in the browser from a metadata snapshot, and that
// snapshot is not typed by hand: a hand-written one would show what somebody
// believed discovery returns, which is the thing the adapter suites exist to
// prove instead (0003). So this starts the shared PostgreSQL fixture (0005) in
// a container, discovers it as its owner with the adapter's own
// `discoverPostgres`, and writes what came back.
//
// It refuses to write a snapshot the shared model disagrees with. The model is
// what both adapters answer to, so a snapshot that disagreed would be showing a
// form for a database neither suite describes.
//
// The two customers the in-memory lookup source offers are read in the same
// run, from the same database, as the text the database spells them with --
// never through a JavaScript number. They carry the snapshot's fingerprint, so
// a test can tell when the two files stop coming from one capture.
//
// Run after `pnpm build`, with Docker:
//
//   pnpm --filter @formancy/data-examples snapshot
//
// and commit both files. Re-run when the fixture changes: the examples suite
// compares the committed snapshot with the model and fails when they disagree.

import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FIXTURE_SCOPE, snapshotDisagreements, startPostgresFixture } from '@formancy/data-fixtures'
import { discoverPostgres } from '@formancy/data-postgres'
import postgres from 'postgres'

const source = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')

const fixture = await startPostgresFixture()
const owner = postgres(fixture.admin, { onnotice: () => {} })
try {
  const snapshot = await discoverPostgres(owner, FIXTURE_SCOPE)
  const disagreements = snapshotDisagreements(snapshot)
  if (disagreements.length > 0) {
    throw new Error(`the discovered snapshot disagrees with the fixture model:\n  ${disagreements.join('\n  ')}`)
  }

  // Cast to text in SQL, as every value in this repository is read: the key
  // columns are integers, and the label is what a person would see.
  const rows = await owner`
    select tenant_id::text as tenant_id, customer_no::text as customer_no, name
    from sales.customer
    order by tenant_id, customer_no
  `

  writeFileSync(join(source, 'fixture-snapshot.json'), `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
  writeFileSync(
    join(source, 'fixture-customers.json'),
    `${JSON.stringify({ snapshotFingerprint: snapshot.fingerprint, rows: rows.map((row) => ({ ...row })) }, null, 2)}\n`,
    'utf8',
  )
  console.log(
    `snapshot: PostgreSQL ${snapshot.serverVersion}, ${String(snapshot.objects.length)} objects, ${String(rows.length)} customers, fingerprint ${snapshot.fingerprint}`,
  )
} finally {
  await owner.end()
  await fixture.stop()
}
