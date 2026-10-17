import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { serverStanding } from '@formancy/data-core'
import { audit, discover, paragraphs, signIn } from './test-studio.js'
import { onServer, OWNER_SNAPSHOT, SQLSERVER_SNAPSHOT, startPlane } from './test-server.js'
import type { TestPlane } from './test-server.js'

/**
 * What a discovery says of the server it was read from (0068): under the
 * line that names the engine and its version, whether this release was
 * tested on it, in data-core's words, when it was not -- and nothing more
 * when it was, so the pane every README picture shows is as it was.
 */
let plane: TestPlane

beforeEach(async () => {
  plane = await startPlane()
})

afterEach(async () => {
  cleanup()
  await plane.close()
})

/** What the pane of `connection` says, paragraph by paragraph, from its first. */
function said(connection: string): string[] {
  return paragraphs(screen.getByRole('region', { name: `What ${connection} can see` }))
}

const TESTED_ON = /^This release of Formancy Data was (not )?tested/

describe('the server a discovery was read from', () => {
  // The upgrade nobody announced reads exactly like the matrix unless the
  // pane says it; said without naming the server, the sentence could be
  // about any of them. Under the server line, before the gaps, because it
  // is about the same server.
  test('says, under the server line, that this release was not tested on it, and names it', async () => {
    plane.databases.set('fixture', onServer(OWNER_SNAPSHOT, '14.24', { product: 'postgresql', major: 14 }))
    const user = await signIn(plane)
    await discover(user, 'fixture')
    const [line, standing] = said('fixture')
    expect(line).toMatch(/^PostgreSQL 14\.24, schemas /)
    expect(standing).toBe('This release of Formancy Data was not tested on PostgreSQL 14: it was tested on PostgreSQL 15, 16, 17 and 18.')
    expect(await audit()).toEqual([])
  })

  // On SQL Server the database's level decides as much as the server's
  // release: a 2022 server whose database was restored from 2017 at 140.
  test('says when the database is below the compatibility level this release was tested at', async () => {
    const restored = onServer(SQLSERVER_SNAPSHOT, SQLSERVER_SNAPSHOT.serverVersion, { product: 'sqlserver', major: 16, compatibility: 140 })
    plane.databases.set('fixture-sqlserver', restored)
    const user = await signIn(plane)
    await discover(user, 'fixture-sqlserver')
    expect(said('fixture-sqlserver')[1]).toBe(serverStanding('sqlserver', restored.server).says)
    expect(said('fixture-sqlserver')[1]).toMatch(/SQL Server 2022 \(16\), and the database’s compatibility level, 140, is below/)
    expect(await audit()).toEqual([])
  })

  // A tested server is the pane as it was: a line on every discovery would
  // be read past, and would move every picture of this pane.
  test('says nothing of a server this release was tested on', async () => {
    const user = await signIn(plane)
    for (const connection of ['fixture', 'fixture-sqlserver']) {
      await discover(user, connection)
      expect(said(connection).filter((sentence) => TESTED_ON.test(sentence))).toEqual([])
    }
  })

  // A snapshot that records no server is not called tested, which
  // serverStanding refuses, and says what is missing rather than nothing.
  test('says when the snapshot does not record the server it was read from', async () => {
    plane.databases.set('fixture', onServer(OWNER_SNAPSHOT, OWNER_SNAPSHOT.serverVersion, undefined))
    const user = await signIn(plane)
    await discover(user, 'fixture')
    expect(said('fixture')[1]).toBe(serverStanding('postgres', undefined).says)
    expect(await audit()).toEqual([])
  })
})
