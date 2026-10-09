// The databases the studio's suite connects to, captured from real ones.
//
// The suite runs the real data server (createDataServer) behind a fake fetch,
// and the server's connection registry needs something to discover. What it
// discovers is not typed by hand: a hand-written snapshot would show what
// somebody believed discovery returns, which is what the adapter suites exist
// to prove instead (0003). So this starts the shared fixture (0005) on both
// engines and discovers it with each adapter's own discovery:
//
//   - PostgreSQL as its owner, who may do everything: the complete snapshot;
//   - PostgreSQL as the restricted reader, who may read sales."order" and
//     nothing else: since 0027 every table described, with what the reader
//     may do column by column, and no gap;
//   - PostgreSQL as the writer, the order form's own account, whom row-level
//     security on customer binds: the snapshot whose forms carry access notes;
//   - SQL Server as its owner: the same model with a rowversion, which the
//     studio shows as a concurrency token with nothing to confirm;
//   - SQL Server as the reader, whose catalog hides what it may not use: the
//     snapshot with gaps, which the studio has to show as "cannot tell"
//     rather than "no relationship" (0004).
//
// It refuses to write any of them if the shared model, or what the fixture
// grants each account, disagrees with it, by the same comparators the adapter
// suites use.
//
// Run after `pnpm build`, with Docker (the SQL Server image is about a
// gigabyte and a half the first time):
//
//   pnpm --filter @formancy/data-studio snapshot
//
// and commit the five files. Re-run when the fixture changes:
// src/fixtures.test.ts compares the committed files with the model and fails
// when they disagree.

import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  accessDisagreements,
  FIXTURE_SCOPE,
  READER_ACCESS,
  restrictedDisagreements,
  snapshotDisagreements,
  startPostgresFixture,
  startSqlServerFixture,
  WRITER_ACCESS,
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
  const writer = postgres(fixture.writer, { onnotice: () => {} })
  try {
    return {
      complete: await discoverPostgres(owner, FIXTURE_SCOPE),
      restricted: await discoverPostgres(reader, FIXTURE_SCOPE),
      writing: await discoverPostgres(writer, FIXTURE_SCOPE),
    }
  } finally {
    await writer.end()
    await reader.end()
    await owner.end()
    await fixture.stop()
  }
}

async function captureSqlServer() {
  const fixture = await startSqlServerFixture()
  const owner = await new mssql.ConnectionPool(fixture.admin).connect()
  const reader = await new mssql.ConnectionPool(fixture.reader).connect()
  try {
    return { complete: await discoverSqlServer(owner, FIXTURE_SCOPE), restricted: await discoverSqlServer(reader, FIXTURE_SCOPE) }
  } finally {
    await reader.close()
    await owner.close()
    await fixture.stop()
  }
}

const pg = await capturePostgres()
const ms = await captureSqlServer()

const problems = [
  ...snapshotDisagreements(pg.complete).map((problem) => `postgres owner: ${problem}`),
  ...restrictedDisagreements(pg.restricted).map((problem) => `postgres reader: ${problem}`),
  ...accessDisagreements(pg.restricted, READER_ACCESS).map((problem) => `postgres reader: ${problem}`),
  ...accessDisagreements(pg.writing, WRITER_ACCESS).map((problem) => `postgres writer: ${problem}`),
  ...snapshotDisagreements(ms.complete).map((problem) => `sqlserver owner: ${problem}`),
  ...restrictedDisagreements(ms.restricted).map((problem) => `sqlserver reader: ${problem}`),
  ...accessDisagreements(ms.restricted, READER_ACCESS).map((problem) => `sqlserver reader: ${problem}`),
]
if (problems.length > 0) throw new Error(`the discovered snapshots disagree with the fixture model:\n  ${problems.join('\n  ')}`)
// The SQL Server reader is the capture that shows "cannot tell"; PostgreSQL's
// catalog answers every role, so its reader and writer have nothing to hide.
if (ms.restricted.gaps.length === 0) throw new Error('the SQL Server reader saw no gap, so no snapshot can show what a restricted account misses')
for (const [who, snapshot] of [['reader', pg.restricted], ['writer', pg.writing]]) {
  if (snapshot.gaps.length > 0) throw new Error(`the PostgreSQL ${who} reported gaps, which 0027 says it cannot have: ${JSON.stringify(snapshot.gaps)}`)
}

mkdirSync(target, { recursive: true })
const write = (name, snapshot) => writeFileSync(join(target, name), `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
write('postgres-owner.json', pg.complete)
write('postgres-reader.json', pg.restricted)
write('postgres-writer.json', pg.writing)
write('sqlserver-owner.json', ms.complete)
write('sqlserver-reader.json', ms.restricted)
console.log(
  `snapshots: PostgreSQL ${pg.complete.serverVersion} owner ${String(pg.complete.objects.length)} objects, reader ${String(pg.restricted.objects.length)}, writer ${String(pg.writing.objects.length)}; SQL Server ${ms.complete.serverVersion} owner ${String(ms.complete.objects.length)} objects, reader ${String(ms.restricted.objects.length)} objects and ${String(ms.restricted.gaps.length)} gaps`,
)
