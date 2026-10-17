import { describe, expect, test } from 'vitest'
import { discoveryRefusal, sqlServerRead } from './server.js'
import type { SqlServerAnswer } from './server.js'

/**
 * What a SQL Server's answer is translated into, and the one answer that
 * discovery refuses (0068): pure, over answers this file writes, because no
 * container can give them. Every image of the matrix is a Developer edition,
 * which answers EngineEdition 3, and has sys.edge_constraints: Azure SQL
 * Database's 5, Managed Instance's 8, and a 2017 without the view are met
 * only here. What each leg's real server answers is
 * server.integration.test.ts's.
 */
const answer = (overrides: Partial<SqlServerAnswer> = {}): SqlServerAnswer => ({
  version: '16.0.4295.3',
  engineEdition: 3,
  majorVersion: '16',
  compatibility: 160,
  edgeConstraints: true,
  ...overrides,
})

describe('sqlServerRead', () => {
  // The Developer edition every container runs, as every leg answers it.
  test('translates a boxed SQL Server: product, major and the connected database’s compatibility level', () => {
    expect(sqlServerRead(answer())).toEqual({ identity: { kind: 'sqlserver', version: '16.0.4295.3', product: 'sqlserver', major: 16, compatibility: 160 }, edgeConstraints: true })
    // Standard, Enterprise or Developer, and Express.
    for (const engineEdition of [2, 3, 4]) expect(sqlServerRead(answer({ engineEdition })).identity.product, String(engineEdition)).toBe('sqlserver')
  })

  // EngineEdition before the major: Azure SQL Database's version is 12,
  // which is 2014 on a boxed server, and Managed Instance's update policy
  // aligns it with 2022 (16) or 2025 (17). The majors fed here are this
  // file's, since Microsoft documents ProductMajorVersion for SQL Server
  // alone. A reader that went by the major would call a Managed Instance
  // answering 16 a tested 2022, and no container can answer either edition
  // to catch it.
  test('reads Azure SQL Database and Managed Instance by EngineEdition, whatever major they answer', () => {
    expect(sqlServerRead(answer({ engineEdition: 5, version: '12.0.2000.8', majorVersion: '12' })).identity).toMatchObject({ product: 'azure-sql-database', major: 12 })
    expect(sqlServerRead(answer({ engineEdition: 8, version: '16.0.1135.2', majorVersion: '16' })).identity).toMatchObject({ product: 'azure-sql-managed-instance', major: 16 })
  })

  // Synapse (6, 11), SQL Edge (9) and an edition no release has named yet
  // speak the protocol and are none of these; unknown is never SQL Server.
  test('calls any other EngineEdition, or none, other', () => {
    for (const engineEdition of [1, 6, 9, 11, 12, null]) expect(sqlServerRead(answer({ engineEdition })).identity.product, String(engineEdition)).toBe('other')
  })

  // ProductMajorVersion is the server's own number; one it did not state
  // is no major, never one parsed out of the build string beside it.
  test('reads the major from ProductMajorVersion, and none when it names none', () => {
    expect(sqlServerRead(answer({ majorVersion: '15', version: '15.0.4500.2' })).identity.major).toBe(15)
    expect(sqlServerRead(answer({ majorVersion: null })).identity.major).toBeNull()
    expect(sqlServerRead(answer({ majorVersion: '' })).identity.major).toBeNull()
  })

  // A level the server did not answer is left out, never written as 0 or
  // as the server's default: data-core calls a SQL Server without one not
  // tested, and a made-up level would decide otherwise.
  test('leaves out a compatibility level the server did not answer', () => {
    expect(sqlServerRead(answer({ compatibility: null })).identity).not.toHaveProperty('compatibility')
  })
})

describe('discoveryRefusal', () => {
  // The catalog read names sys.edge_constraints (discovery's referenced-by
  // and every delete), which SQL Server has from 2019. Without it, discovery
  // failed as "Invalid object name" and said nothing of the version; now it
  // refuses before reading the catalog, naming the release.
  test('refuses a server without sys.edge_constraints, naming the release it answered', () => {
    expect(discoveryRefusal(sqlServerRead(answer({ version: '14.0.3485.1', majorVersion: '14', compatibility: 140, edgeConstraints: false })))).toBe(
      'SQL Server 2017 (14) cannot be discovered: this adapter reads sys.edge_constraints, which SQL Server has from 2019 (15).',
    )
    expect(discoveryRefusal(sqlServerRead(answer({ engineEdition: 9, edgeConstraints: false })))).toBe(
      'A server that speaks SQL Server’s protocol and is no SQL Server product Formancy Data knows cannot be discovered: this adapter reads sys.edge_constraints, which SQL Server has from 2019 (15).',
    )
  })

  // Decided by the view and not by the major: Azure SQL Database answers 12
  // and has sys.edge_constraints, and a refusal of everything below 15 would
  // turn away every Azure SQL estate a partner brings, which can be read.
  test('refuses nothing that has sys.edge_constraints, whatever major it answers', () => {
    expect(discoveryRefusal(sqlServerRead(answer({ engineEdition: 5, version: '12.0.2000.8', majorVersion: '12' })))).toBeUndefined()
    expect(discoveryRefusal(sqlServerRead(answer({ version: '15.0.4500.2', majorVersion: '15', compatibility: 150 })))).toBeUndefined()
    expect(discoveryRefusal(sqlServerRead(answer()))).toBeUndefined()
  })
})
