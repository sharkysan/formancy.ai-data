import { serverStanding } from '@formancy/data-core'
import { describe, expect, test } from 'vitest'
import { postgresServer } from './server.js'

/**
 * What a PostgreSQL server's answer is translated into (0068): pure, over
 * answers this file writes, because no container can give them. Every image
 * the suites start is alpine, and every alpine server answers a bare
 * `server_version`, such as `17.11`, and a `version()` that begins "PostgreSQL";
 * a Debian package's `16.4 (Debian 16.4-1.pgdg120+1)` and a fork that is not
 * PostgreSQL are met only here. What each leg's real server answers is
 * server.integration.test.ts's.
 */
const answer = (
  version: string,
  versionNum: string,
  description = `PostgreSQL ${version} on x86_64-pc-linux-musl, compiled by gcc (Alpine 14.2.0) 14.2.0, 64-bit`,
) => ({
  version,
  versionNum,
  description,
})

describe('postgresServer', () => {
  // The major is server_version_num divided by 10000, from 10 on, and 9 for
  // 9.6: an integer the server states as one, whatever text a packager put
  // after the version. The alpine answer is every leg's.
  test('reads the major from server_version_num, on an alpine and a Debian build and an old 9.6', () => {
    expect(postgresServer(answer('17.6', '170006'))).toEqual({ kind: 'postgres', version: '17.6', product: 'postgresql', major: 17 })
    const debian = answer(
      '16.4 (Debian 16.4-1.pgdg120+1)',
      '160004',
      'PostgreSQL 16.4 (Debian 16.4-1.pgdg120+1) on x86_64-pc-linux-gnu, compiled by gcc (Debian 12.2.0-14) 12.2.0, 64-bit',
    )
    expect(postgresServer(debian)).toEqual({ kind: 'postgres', version: '16.4 (Debian 16.4-1.pgdg120+1)', product: 'postgresql', major: 16 })
    expect(postgresServer(answer('9.6.24', '90624')).major).toBe(9)
    expect(postgresServer(answer('18beta1', '180000')).major).toBe(18)
  })

  // The two never disagree on a real server; written so here, the case
  // shows which one is read. A major parsed from the text would follow a
  // packager's spelling, and a development build's `18devel` names none.
  test('never reads the major from server_version’s text', () => {
    expect(postgresServer(answer('16.4 (Debian 16.4-1.pgdg120+1)', '170000')).major).toBe(17)
    expect(postgresServer(answer('18devel', '180000')).major).toBe(18)
  })

  // A number the server did not state as an integer is no major: a guess
  // would put a version the server never said into the snapshot.
  test('answers no major for a server_version_num that is not an integer', () => {
    expect(postgresServer(answer('17.6', '')).major).toBeNull()
    expect(postgresServer(answer('17.6', '17.6')).major).toBeNull()
  })

  // A database that speaks PostgreSQL's protocol answers these settings too,
  // with a major of its own numbering; only version() tells it apart, and
  // read as PostgreSQL it would be called tested.
  test('calls a server PostgreSQL only when version() begins "PostgreSQL "', () => {
    expect(postgresServer(answer('13.0.0', '130000', 'CockroachDB CCL v23.1.11 (x86_64-pc-linux-gnu, built 2023/09/27 01:53:43, go1.19.10)')).product).toBe(
      'other',
    )
    expect(postgresServer(answer('17.6', '170006', 'postgresql 17.6')).product).toBe('other')
    expect(postgresServer(answer('17.6', '170006', 'PostgreSQLish 17.6')).product).toBe('other')
  })

  // The other side of that line, which the register states as a cost of
  // 0068: a server built elsewhere -- a managed service, another platform,
  // another compiler -- whose version() begins "PostgreSQL " is PostgreSQL
  // of the major it states, and of a tested major it is called tested,
  // whatever it changed. Called untested instead, every managed estate
  // would read as one nobody ran; this holds the register's sentence to
  // what the code does.
  test('calls a server built elsewhere PostgreSQL of its major, and tested on a tested major, whatever else it changed', () => {
    const elsewhere = postgresServer(
      answer('16.4', '160004', 'PostgreSQL 16.4 on aarch64-unknown-linux-gnu, compiled by aarch64-unknown-linux-gnu-gcc (GCC) 9.5.0, 64-bit'),
    )
    expect(elsewhere).toEqual({ kind: 'postgres', version: '16.4', product: 'postgresql', major: 16 })
    expect(serverStanding('postgres', elsewhere).tested).toBe(true)
  })
})
