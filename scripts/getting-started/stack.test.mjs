import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
import { classify, MISSING } from './journey.mjs'
import { anonymousMountProblems, auditEvents, bindMountProblems, configProblems, exposureProblems, leaks, namedSecretFiles, noticesProblem, pageReferences, redact, styleReferences } from './stack.mjs'

/**
 * The gate's checks that need no Docker, held to cases (0032). Each is also
 * watched failing against the real stack, and 0032 records how; these say
 * what each accepts and refuses, so a change to one cannot quietly widen it.
 */

/** compose's resolved configuration as `docker compose config --format json` prints it, cut to what the check reads. */
const config = (services) => ({ services })
const loopback = (target, published) => ({ mode: 'ingress', host_ip: '127.0.0.1', target, published: String(published), protocol: 'tcp' })

describe('the compose configuration check', () => {
  // The shape compose.yaml has: loopback ports, references and _FILE paths.
  // A check that refused it would fail every run and be switched off.
  test('passes the composed stack as it is meant to be', () => {
    expect(
      configProblems(
        config({
          web: { ports: [loopback(8080, 4394)] },
          postgres: { ports: [loopback(5432, 5440)], environment: { POSTGRES_USER: 'formancy', POSTGRES_PASSWORD_FILE: '/run/formancy-secrets/postgres-owner-password' } },
          server: { environment: { FORMANCY_DATA_IDENTITY_SECRET: 'file:/run/formancy-secrets/host-token-secret', FORMANCY_DATA_AUDIT_KEY: 'file:/run/formancy-secrets/audit-key' } },
          secrets: { restart: 'no' },
        }),
      ),
    ).toEqual([])
  })

  // An `env:` reference is only as good as the variable it names. Under a
  // name the secret-name pattern does not match, that variable can hold the
  // key itself, in compose.yaml, a committed file -- and the leak check never
  // looks for it, because it only searches for what the secrets volume holds.
  // A relative `file:` reference resolves against wherever the server runs.
  test.each([
    ['an env: reference to a variable holding the key', { FORMANCY_DATA_AUDIT_KEY: 'env:AUDIT', AUDIT: 'Fd1-literal-key-in-compose' }],
    ['an env: reference to nothing', { FORMANCY_DATA_IDENTITY_SECRET: 'env:SIGNING' }],
    ['a relative file: reference', { FORMANCY_DATA_IDENTITY_SECRET: 'file:secrets/host-token-secret' }],
  ])('refuses %s', (_, environment) => {
    const problems = configProblems(config({ server: { environment } }))
    expect(problems).toEqual([`server's ${Object.keys(environment)[0]} holds a value of its own; a secret here is a file: reference or a _FILE setting, naming an absolute path`])
    expect(problems.join('')).not.toContain('Fd1-literal')
  })

  // The guide's section 8 says nothing restarts on its own, so after a
  // reboot the operator runs the start command again. A restart policy on a
  // service would make that sentence false, and an evaluation stack that
  // comes back on every boot is one the operator did not ask to keep.
  test('refuses a service that restarts on its own', () => {
    expect(configProblems(config({ server: { restart: 'unless-stopped' }, secrets: { restart: 'no' } }))).toEqual([
      "server restarts on its own (restart: unless-stopped), and the guide's section 8 says nothing does",
    ])
  })

  // A port on every interface puts an unauthenticated database login on the
  // machine's network; a published server is a second origin beside nginx.
  test('refuses a port off loopback, and any port on the server', () => {
    const problems = configProblems(config({ sqlserver: { ports: [{ ...loopback(1433, 1434), host_ip: '0.0.0.0' }] }, server: { ports: [loopback(4390, 4390)] } }))
    expect(problems).toEqual(['sqlserver publishes port 1433 on 0.0.0.0, not on 127.0.0.1', "server publishes port 4390; the browser's way in is web, on one origin"])
  })

  // An interpolated secret is printed by `docker compose config` and `docker
  // inspect`. The sentence names the setting and never the value, because the
  // value is the secret.
  test.each([
    ['a password', { MSSQL_SA_PASSWORD: 'Fd1-not-a-reference' }],
    ['a key', { FORMANCY_DATA_AUDIT_KEY: 'Fd1-not-a-reference' }],
    ['a token, whatever its case', { host_token: 'Fd1-not-a-reference' }],
    ['a _FILE setting with a relative path', { POSTGRES_PASSWORD_FILE: 'secrets/owner' }],
    ['an empty secret', { POSTGRES_PASSWORD: '' }],
  ])('refuses %s held as a value, naming it without the value', (_, environment) => {
    const problems = configProblems(config({ db: { environment } }))
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain(`db's ${Object.keys(environment)[0]}`)
    expect(problems[0]).not.toContain('Fd1-not-a-reference')
  })
})

describe('the secrets a service can read', () => {
  const connections = JSON.stringify([
    { id: 'pg', password: 'file:/run/formancy-secrets/pg-writer-password' },
    { id: 'ms', password: 'file:/run/formancy-secrets/ms-writer-password' },
  ])
  const server = {
    environment: {
      FORMANCY_DATA_IDENTITY_SECRET: 'file:/run/formancy-secrets/host-token-secret',
      FORMANCY_DATA_AUDIT_KEY: 'file:/run/formancy-secrets/audit-key',
      FORMANCY_DATA_CONNECTIONS: '/etc/formancy-data/connections.json',
    },
    volumes: [{ type: 'bind', source: '/checkout/deploy/connections.json', target: '/etc/formancy-data/connections.json', read_only: true }],
  }

  // What the server is configured to read: its own settings' references, and
  // the passwords of the connections file it is given -- read from the file
  // compose mounts, so a connection added there is a secret the server may
  // read without the gate being told.
  test("are named by the service's settings and its connections file", () => {
    const read = (path) => (path === '/checkout/deploy/connections.json' ? connections : '')
    expect([...namedSecretFiles(server, read)].sort()).toEqual([
      '/run/formancy-secrets/audit-key',
      '/run/formancy-secrets/host-token-secret',
      '/run/formancy-secrets/ms-writer-password',
      '/run/formancy-secrets/pg-writer-password',
    ])
    expect([...namedSecretFiles({ environment: { POSTGRES_PASSWORD_FILE: '/run/formancy-secrets/postgres-owner-password' } }, read)]).toEqual([
      '/run/formancy-secrets/postgres-owner-password',
    ])
  })

  // Every browser request reaches the server, and the minter is run by hand.
  // A file-read bug in either must not hand over an administrator's
  // password: what a service can read beyond what it names is named back,
  // never its contents.
  test('beyond what the service names are refused, by path', () => {
    const named = new Set(['/run/formancy-secrets/host-token-secret'])
    expect(exposureProblems('token', named, ['/run/formancy-secrets/host-token-secret', '/run/formancy-secrets/mssql-sa-password'])).toEqual([
      'token can read /run/formancy-secrets/mssql-sa-password, which nothing in its configuration names',
    ])
    expect(exposureProblems('token', named, ['/run/formancy-secrets/host-token-secret'])).toEqual([])
  })
})

// Modes are a POSIX matter: on Windows Node reports every file readable by
// everybody, and Docker Desktop's mounts do not check them.
describe.skipIf(process.platform === 'win32')('the bind mounts', () => {
  const checkout = mkdtempSync(join(tmpdir(), 'gate-binds-'))
  afterAll(() => rmSync(checkout, { recursive: true, force: true }))
  mkdirSync(join(checkout, 'seed'), { mode: 0o755 })
  writeFileSync(join(checkout, 'seed', 'sqlserver.sh'), 'echo\n', { mode: 0o644 })
  writeFileSync(join(checkout, 'connections.json'), '[]\n', { mode: 0o644 })
  const services = (user) => ({
    'seed-sqlserver': { ...(user === undefined ? {} : { user }), volumes: [{ type: 'bind', source: join(checkout, 'seed'), target: '/seed', read_only: true }] },
    server: { volumes: [{ type: 'bind', source: join(checkout, 'connections.json'), target: '/etc/formancy-data/connections.json' }, { type: 'volume', source: 'store', target: '/var/lib/formancy-data' }] },
  })

  // A checkout made under umask 027 or 077 gives files other users cannot
  // read, and a container that runs as its image's own user -- node, mssql
  // -- is such another user. The stack then fails in a seed or at the
  // server's start, with "Permission denied" in a log; this says which file,
  // which service, and what the guide asks for, before anything starts.
  test("refuse a file a service that is not root reads, and other users cannot", () => {
    chmodSync(join(checkout, 'seed', 'sqlserver.sh'), 0o640)
    chmodSync(join(checkout, 'connections.json'), 0o600)
    try {
      expect(bindMountProblems({ services: services(undefined) })).toEqual([
        `seed-sqlserver reads ${join(checkout, 'seed', 'sqlserver.sh')}, which other users cannot read, as its image's user rather than root; the guide's section 0 asks for a checkout other users can read`,
        `server reads ${join(checkout, 'connections.json')}, which other users cannot read, as its image's user rather than root; the guide's section 0 asks for a checkout other users can read`,
      ])
      // Root reads it whatever its mode, so a seed that runs as root is not refused.
      expect(bindMountProblems({ services: services('0') })).toEqual([expect.stringMatching(/^server reads /)])
    } finally {
      chmodSync(join(checkout, 'seed', 'sqlserver.sh'), 0o644)
      chmodSync(join(checkout, 'connections.json'), 0o644)
    }
    expect(bindMountProblems({ services: services(undefined) })).toEqual([])
  })
})

describe('the volumes a container mounts', () => {
  /** A container as `docker inspect` describes it, cut to what the check reads. */
  const container = (service, mounts) => ({ Config: { Labels: { 'com.docker.compose.service': service } }, Mounts: mounts })
  const volume = (Destination) => ({ Type: 'volume', Name: `named-or-not-${Destination}`, Destination })
  const services = {
    secrets: { volumes: [{ type: 'bind', source: '/checkout/deploy/secrets.sh', target: '/deploy/secrets.sh' }, { type: 'volume', source: 'formancy-data-secrets', target: '/secrets' }] },
    'seed-postgres': { volumes: [{ type: 'volume', source: 'formancy-data-secrets-postgres', target: '/run/formancy-secrets' }], tmpfs: ['/var/lib/postgresql/data'] },
  }

  // The postgres image declares its data directory a VOLUME, and `secrets`
  // and `seed-postgres` use the image for sh and psql and mounted nothing
  // there: each container got a volume of its own that no label ties to the
  // project, the guide's `down` kept it, and `down -v` after the next start
  // could not find it -- two left on the machine for every stop and start.
  test('names one the service does not, by service and path', () => {
    expect(
      anonymousMountProblems(
        [
          container('secrets', [volume('/secrets'), { Type: 'bind', Destination: '/deploy/secrets.sh' }, volume('/var/lib/postgresql/data')]),
          container('seed-postgres', [volume('/run/formancy-secrets')]),
        ],
        { services },
      ),
    ).toEqual(["secrets mounts a volume at /var/lib/postgresql/data that its configuration does not name, which the guide's `down` leaves behind for good"])
  })

  // A named volume compose.yaml mounts is the configuration's own, with the
  // project's label, and a check that refused it would fail every run. A
  // tmpfs over the image's VOLUME, which is how compose.yaml keeps Docker from
  // making one, is no volume in `docker inspect` at all.
  test('passes every one the service names', () => {
    expect(anonymousMountProblems([container('secrets', [volume('/secrets')]), container('seed-postgres', [volume('/run/formancy-secrets')])], { services })).toEqual([])
  })
})

describe('the audit trail', () => {
  // The guide says the audit trail is the server's log here, and that `down`
  // removes it with the container. The gate finds the journey's creates in
  // that log before `down` and none after the start that follows; these say
  // what counts as one, so a line that only mentions "audit" does not.
  test('is read from the structured lines the server logs, and nothing else', () => {
    const log = [
      '{"level":30,"msg":"planes","runtime":true}',
      '{"level":30,"audit":{"operation":"create","form":"pg-order","status":201,"outcome":"ok"},"msg":"audit"}',
      'not json at all, with "audit" in it',
      '{"level":30,"audit":{"operation":"read","form":"pg-order","status":200,"outcome":"ok"},"msg":"audit"}',
    ].join('\n')
    expect(auditEvents(log).map((event) => `${event.operation} ${event.form} ${String(event.status)}`)).toEqual(['create pg-order 201', 'read pg-order 200'])
  })
})

describe('the leak check', () => {
  const secrets = new Map([['host-token-secret', 'Fd1-aaaaaaaaaaaaaaaaaaaaaaaa']])
  const tokens = new Map([['clerk1', 'eyJx.eyJy.sig']])

  // A secret in a log is found and named by its file and its place; the
  // sentence that reports it must not carry it on into the CI log.
  test('names the secret and the place, never the value', () => {
    const found = leaks({ secrets, tokens, haystacks: [{ where: 'the logs of seed-postgres', text: 'password is Fd1-aaaaaaaaaaaaaaaaaaaaaaaa\n' }] })
    expect(found).toEqual(['the secret host-token-secret is in the logs of seed-postgres'])
    expect(found.join('')).not.toContain('Fd1-aaaa')
  })

  // The guide's own token command prints the token -- that is its job. Any
  // other place, the access log above all, is a leak.
  test('allows a token only in the output of the command that minted it', () => {
    const haystacks = [
      { where: 'the output of the guide\'s step on line 82', text: 'eyJx.eyJy.sig\n', mints: 'clerk1' },
      { where: 'the logs of web', text: 'GET /v1/whoami?t=eyJx.eyJy.sig 200' },
    ]
    expect(leaks({ secrets, tokens, haystacks })).toEqual(['the clerk1 token is in the logs of web'])
  })

  // What is printed after a failure goes through this first.
  test('redacts every secret and token from output printed after a failure', () => {
    expect(redact('a Fd1-aaaaaaaaaaaaaaaaaaaaaaaa b eyJx.eyJy.sig', { secrets, tokens })).toBe('a [secret host-token-secret] b [clerk1 token]')
  })
})

describe('the page check', () => {
  // Vite writes the stylesheet's link over several lines and with its
  // attributes in any order; a reader that missed it would check no asset.
  test('reads every script src and link href, across lines', () => {
    const html = '<script type="module" crossorigin src="/studio/assets/index-B7.js"></script>\n<link\n  href="https://fonts.googleapis.com/css2?family=X"\n  rel="stylesheet"\n/>\n<link rel=stylesheet href=/studio/assets/index-D.css>'
    expect(pageReferences(html)).toEqual([
      { tag: 'script', url: '/studio/assets/index-B7.js' },
      { tag: 'link', url: 'https://fonts.googleapis.com/css2?family=X' },
      { tag: 'link', url: '/studio/assets/index-D.css' },
    ])
  })

  // A font or an image a stylesheet names is a request the browser makes
  // and the gate must make too.
  test('reads every url() and quoted @import of a stylesheet', () => {
    expect(styleReferences('@import "a.css";a{background:url(img/x.png)}b{src:url("f.woff2") format("woff2")}c{d:url(data:image/png;base64,AA)}')).toEqual([
      'img/x.png',
      'f.woff2',
      'data:image/png;base64,AA',
      'a.css',
    ])
  })

  // Each page's build writes its third-party notices beside it (0046), in
  // UTF-8, and a browser left to guess the encoding of a bare text/plain can
  // garble a licence's accented name or copyright sign: nginx must say
  // UTF-8. A build without the plugin answers 404, and nginx without
  // `charset` a bare text/plain; both are what the stack check catches. The
  // status is checked as well as the type: an error page or a redirect
  // served as UTF-8 text -- the check follows no redirect, as a browser's
  // first request does not -- is no notices file.
  test('wants each page’s notices as UTF-8 text', () => {
    expect(noticesProblem('/studio/THIRD-PARTY-NOTICES.txt', 200, 'text/plain; charset=utf-8')).toBeUndefined()
    expect(noticesProblem('/host/THIRD-PARTY-NOTICES.txt', 200, 'text/plain; charset=UTF-8')).toBeUndefined()
    expect(noticesProblem('/host/THIRD-PARTY-NOTICES.txt', 200, 'text/plain')).toBe('/host/THIRD-PARTY-NOTICES.txt answered 200 text/plain, not 200 text/plain; charset=utf-8')
    expect(noticesProblem('/studio/THIRD-PARTY-NOTICES.txt', 404, 'text/html')).toBe('/studio/THIRD-PARTY-NOTICES.txt answered 404 text/html, not 200 text/plain; charset=utf-8')
    expect(noticesProblem('/studio/THIRD-PARTY-NOTICES.txt', 200, 'text/plain; charset=iso-8859-1')).toBeDefined()
    expect(noticesProblem('/host/THIRD-PARTY-NOTICES.txt', 404, 'text/plain; charset=utf-8')).toBe('/host/THIRD-PARTY-NOTICES.txt answered 404 text/plain; charset=utf-8, not 200 text/plain; charset=utf-8')
    expect(noticesProblem('/host/THIRD-PARTY-NOTICES.txt', 301, 'text/plain; charset=utf-8')).toBeDefined()
  })
})

describe('the token classification', () => {
  const settings = { adminRoles: ['data-admin'], clerkRole: 'clerk' }

  // By the identity the server derived, so a token the server reads
  // differently from what its command said is not counted as that identity.
  test.each([
    [{ actor: { id: 'ada', roles: ['data-admin'] }, attributes: {} }, 'admin'],
    [{ actor: { id: 'clara', roles: ['clerk'] }, attributes: { tenant: '1' } }, 'clerk1'],
    [{ actor: { id: 'otto', roles: ['clerk'] }, attributes: { tenant: '2' } }, 'clerk2'],
    [{ actor: { id: 'eve', roles: ['clerk'] }, attributes: {} }, undefined],
    [{ actor: { id: 'eve', roles: ['viewer'] }, attributes: { tenant: '1' } }, undefined],
  ])('reads %j as %s', (identity, name) => {
    expect(classify(identity, settings)).toBe(name)
  })

  // The sentence the gate fails with when the guide lost a token command.
  test('says which token the guide does not mint', () => {
    expect(MISSING.clerk1).toBe('the guide mints no clerk token for tenant 1')
  })
})
