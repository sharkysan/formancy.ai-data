// The databases the studio's suite connects to, captured from real ones.
//
// The suite runs the real data server (createDataServer) behind a fake fetch,
// and the server's connection registry needs something to discover. What it
// discovers is not typed by hand: a hand-written snapshot would show what
// somebody believed discovery returns, which is what the adapter suites exist
// to prove instead (0003). So this starts the shared fixture (0005) on both
// engines and discovers it with each adapter's own discovery:
//
//   - PostgreSQL as its owner, who sees everything: the complete snapshot;
//   - PostgreSQL as the restricted reader, who may read sales."order" and
//     nothing else: the snapshot with gaps, which the studio has to show as
//     "cannot tell" rather than "no relationship" (0004);
//   - SQL Server as its owner: the same model with a rowversion, which the
//     studio shows as a concurrency token with nothing to confirm.
//
// It refuses to write any of them if the shared model disagrees with it, by
// the same comparators the adapter suites use.
//
// Run after `pnpm build`, with Docker (the SQL Server image is about a
// gigabyte and a half the first time):
//
//   pnpm --filter @formancy/data-studio snapshot
//
// and commit the three files. Re-run when the fixture changes:
// src/fixtures.test.ts compares the committed files with the model and fails
// when they disagree.

import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  FIXTURE_SCOPE,
  restrictedDisagreements,
  snapshotDisagreements,
  startPostgresFixture,
  startSqlServerFixture,
} from '@formancy/data-fixtures'
import { discoverPostgres } from '@formancy/data-postgres'
import { discoverSqlServer } from '@formancy/data-sqlserver'
import postgres from 'postgres'

// The pool must come from the adapter's own copy of the driver: it binds
// parameters with that copy's type objects, and a pool from another copy --
// pnpm installs one per peer resolution -- refuses them ("type.validate is
// not a function"). So the driver is required from where the adapter is.
const mssql = createRequire(fileURLToPath(import.meta.resolve('@formancy/data-sqlserver')))('mssql')

const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'fixtures')

async function capturePostgres() {
  const fixture = await startPostgresFixture()
  const owner = postgres(fixture.admin, { onnotice: () => {} })
  const reader = postgres(fixture.reader, { onnotice: () => {} })
  try {
    return { complete: await discoverPostgres(owner, FIXTURE_SCOPE), restricted: await discoverPostgres(reader, FIXTURE_SCOPE) }
  } finally {
    await reader.end()
    await owner.end()
    await fixture.stop()
  }
}

async function captureSqlServer() {
  const fixture = await startSqlServerFixture()
  const owner = await new mssql.ConnectionPool(fixture.admin).connect()
  try {
    return await discoverSqlServer(owner, FIXTURE_SCOPE)
  } finally {
    await owner.close()
    await fixture.stop()
  }
}

const { complete, restricted } = await capturePostgres()
const sqlserver = await captureSqlServer()

const problems = [
  ...snapshotDisagreements(complete).map((problem) => `postgres owner: ${problem}`),
  ...restrictedDisagreements(restricted).map((problem) => `postgres reader: ${problem}`),
  ...snapshotDisagreements(sqlserver).map((problem) => `sqlserver owner: ${problem}`),
]
if (problems.length > 0) throw new Error(`the discovered snapshots disagree with the fixture model:\n  ${problems.join('\n  ')}`)
if (restricted.gaps.length === 0) throw new Error('the reader saw no gap, so the snapshot cannot show what a restricted account misses')

mkdirSync(target, { recursive: true })
const write = (name, snapshot) => writeFileSync(join(target, name), `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
write('postgres-owner.json', complete)
write('postgres-reader.json', restricted)
write('sqlserver-owner.json', sqlserver)
console.log(
  `snapshots: PostgreSQL ${complete.serverVersion} owner ${String(complete.objects.length)} objects, reader ${String(restricted.objects.length)} objects and ${String(restricted.gaps.length)} gaps; SQL Server ${sqlserver.serverVersion} owner ${String(sqlserver.objects.length)} objects`,
)
