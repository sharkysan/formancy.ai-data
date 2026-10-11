import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { ingressYaml, probes } from '../../deploy/cloudflare/ingress.mjs'
import { routedHostnames, setup } from '../../deploy/cloudflare/setup.mjs'
import { standIn } from './stand-in.mjs'

/**
 * deploy/cloudflare/setup.mjs's order and every place it stops (0037),
 * against a stand-in for cloudflared that answers as each case says. Nothing
 * can run setup against an account in CI: what Cloudflare answers to a
 * login, a create or a route is not known here, only what setup does with
 * success and failure. Each case says which mistake it rules out.
 */
const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const doors = JSON.parse(readFileSync(join(repo, 'deploy', 'cloudflare', 'doors.json'), 'utf8'))
const ID = '6ff42ae2-765d-4adf-8112-31c55c1551ef'
const SECRET = 'c2V0dXAgc3RhbmQtaW4gc2VjcmV0IHRoYXQgbXVzdCBub3QgYmUgcHJpbnRlZA=='
const AUD = '0123456789abcdef'.repeat(4)
const argv = ['--admin', 'formancy.example.com', '--team', 'example-team', '--aud', AUD]
const inputs = { admin: 'formancy.example.com', team: 'example-team', aud: AUD }

let dir
let cloudflared
let printed
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'formancy-data-setup-'))
  cloudflared = standIn(dir)
  printed = []
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const credentials = () => join(dir, 'credentials.json')
const next = () => join(dir, 'config.yml.new')

/** What a successful run is answered, step by step, `change` replacing an answer by its first word. */
function plan(given, change = {}) {
  const answers = {
    login: { args: ['tunnel', 'login'], out: 'Please open the following URL and log in with your Cloudflare account:\n\nhttps://dash.cloudflare.com/argotunnel?aud=&callback=x\n' },
    create: {
      args: ['tunnel', 'create', '--credentials-file', credentials(), 'formancy-data'],
      // The stand-in prints the secret, so the redaction is what keeps it
      // out of what setup prints, whatever cloudflared says.
      out: `Tunnel credentials written to ${credentials()}. Secret ${SECRET}\nCreated tunnel formancy-data with id ${ID}\n`,
      writes: { path: credentials(), content: JSON.stringify({ AccountTag: 'a'.repeat(32), TunnelSecret: SECRET, TunnelID: ID }) },
    },
    // What cloudflared 2026.10.0 prints for no route with --output json:
    // its renderOutput encodes the list it fetched, and an empty one is
    // null (cmd/cloudflared/tunnel/subcommands.go, cfapi/ip_route.go; read
    // from the source, not seen from an account).
    'route ip': { args: ['tunnel', 'route', 'ip', 'show', '--filter-tunnel-id', ID, '--output', 'json'], out: 'null\n' },
    'route formancy.example.com': { args: ['tunnel', 'route', 'dns', ID, 'formancy.example.com'], out: 'Added CNAME formancy.example.com\n' },
    'route app.example.com': { args: ['tunnel', 'route', 'dns', ID, 'app.example.com'], out: 'Added CNAME app.example.com\n' },
    version: { args: ['--version'], out: 'cloudflared version 2026.10.0 (stand-in)\n' },
    validate: { args: ['tunnel', '--config', next(), 'ingress', 'validate'], out: 'OK\n' },
  }
  for (const [name, answer] of Object.entries(change)) answers[name] = { ...answers[name], ...answer }
  cloudflared.plan([...Object.values(answers), ...probes(doors, given).map((probe) => ({ args: ['tunnel', '--config', next(), 'ingress', 'rule', probe.url], out: `Matched rule #${String(probe.rule)}\n` }))])
}

const run = (args = argv) =>
  setup({ argv: args, doors, dir, cloudflared: cloudflared.binary, owner: null, interactive: false, print: (line) => printed.push(line), report: (line) => printed.push(line) })
const steps = () => cloudflared.asked().map((args) => (args[0] === '--version' ? 'version' : args[1] === '--config' ? args[4] === 'rule' ? 'rule' : 'validate' : args.slice(1, 3).join(' ')))

describe('setup', () => {
  // A wrong input caught after the login leaves a token to revoke and maybe
  // a tunnel for nothing; caught first, cloudflared is never asked.
  test('does nothing, cloudflared asked nothing, when an input is wrong', () => {
    plan(inputs)
    expect(run(['--admin', 'Formancy.example.com', '--team', 'example-team', '--aud', AUD])).toBe(1)
    expect(cloudflared.asked()).toEqual([])
    expect(printed.at(-1)).toBe('Nothing was done.')
  })

  // The order is the design's: log in, create, route, then write and check
  // the configuration; the secret cloudflared wrote is printed nowhere, and
  // the last thing said is how to revoke the login nothing else revokes.
  test('logs in, creates the tunnel, routes the hostname, writes the checked configuration, and says to revoke the login', () => {
    plan(inputs)
    expect(run()).toBe(0)
    expect([...new Set(steps())]).toEqual(['login', 'create --credentials-file', 'route ip', 'route dns', 'version', 'validate', 'rule'])
    expect(readFileSync(join(dir, 'config.yml'), 'utf8')).toBe(ingressYaml(doors, inputs, ID))
    expect((statSync(credentials()).mode & 0o777).toString(8)).toBe('400')
    expect(printed.join('\n')).not.toContain(SECRET)
    expect(printed.join('\n')).toContain('[the tunnel secret]')
    expect(printed.join('\n')).toMatch(/Revoke the login now: My Profile → API Tokens → 'Cloudflare Tunnel API Token'/)
    expect(printed.join('\n')).toMatch(/Routed in DNS by this run: formancy\.example\.com\./)
  })

  // A failed login has made nothing: no tunnel is created without one. But
  // cloudflared, failing to fetch the certificate, tells the operator the
  // browser will download it instead (login.go), and that file is the
  // account-wide login, outside the tmpfs: setup says to delete it and
  // revoke its token, since it cannot use it.
  test('stops after a failed login, before anything is created, and says what to do with a downloaded cert.pem', () => {
    plan(inputs, { login: { status: 1, err: 'Failed to write the certificate.\n\nYour browser will download the certificate instead.\n' } })
    expect(run()).toBe(1)
    expect(steps()).toEqual(['login'])
    expect(printed.at(-1)).toMatch(/could not log in/)
    expect(printed.at(-1)).toMatch(/If your browser downloaded a cert\.pem, delete it and revoke its token .*: it can manage every tunnel of the account, and setup cannot use it\./)
  })

  // The login chooses one zone, and route dns creates the records in it: a
  // host application's hostname in another zone could not be routed. Both
  // are named before the operator chooses.
  test('names both hostnames when it asks for the zone', () => {
    plan(inputs, { login: { status: 1 } })
    run([...argv, '--app', 'app.example.com'])
    expect(printed[0]).toMatch(/choose the zone that holds formancy\.example\.com and app\.example\.com; both must be in that one zone/)
  })

  // A private network route to this tunnel lets every enrolled device the
  // organisation's policy allows reach whatever cloudflared's container
  // reaches -- the web front without Access among it -- and no setting of
  // cloudflared turns that off (its CHANGES.md, 2023.9.0). Seen while the
  // login lasts, it stops setup before any hostname is routed to the tunnel.
  test('stops when a private network route sends traffic to the tunnel, before routing any hostname', () => {
    const route = { id: 'b0e1c8a2-0000-4000-8000-000000000001', network: '10.0.0.0/8', tunnel_id: ID, comment: '', created_at: '2026-10-11T00:00:00Z', deleted_at: '0001-01-01T00:00:00Z', tunnel_name: 'formancy-data' }
    plan(inputs, { 'route ip': { out: `${JSON.stringify([route], null, 2)}\n` } })
    expect(run()).toBe(1)
    expect([...new Set(steps())]).toEqual(['login', 'create --credentials-file', 'route ip'])
    expect(printed.at(-1)).toMatch(/1 private network route sends traffic to the tunnel formancy-data \(10\.0\.0\.0\/8\)/)
    expect(printed.at(-1)).toMatch(/Delete it under Networking → Routes/)
    expect(existsSync(join(dir, 'config.yml'))).toBe(false)
  })

  // cloudflared's answer is read from its source, not seen from an account:
  // when it cannot list the routes, or prints what setup does not read,
  // setup goes on -- a tunnel it creates has no route yet -- and says it
  // could not tell, so the operator knows the check was not made.
  test('goes on, and says it could not tell, when cloudflared cannot list the routes', () => {
    plan(inputs, { 'route ip': { status: 1, out: '', err: 'REST request failed\n' } })
    expect(run()).toBe(0)
    expect(printed.join('\n')).toMatch(/could not tell whether a private network route sends traffic to the tunnel/)
  })

  // Run again with fewer arguments than the configuration in use was
  // written with, setup would log in, then refuse at configure, leaving a
  // token to revoke for nothing: the check comes first.
  test('does nothing, cloudflared asked nothing, when its arguments would remove a door', () => {
    writeFileSync(credentials(), JSON.stringify({ AccountTag: 'a'.repeat(32), TunnelSecret: SECRET, TunnelID: ID }))
    writeFileSync(join(dir, 'config.yml'), ingressYaml(doors, { ...inputs, app: 'app.example.com' }, ID))
    plan(inputs)
    expect(run()).toBe(1)
    expect(cloudflared.asked()).toEqual([])
    expect(printed.join('\n')).toMatch(/forwards the runtime routes on app\.example\.com, and these arguments would not/)
    expect(printed.at(-1)).toBe('Nothing was done.')
  })

  // A tunnel of that name without its credentials here cannot be run from
  // here, and setup does not delete what it did not create.
  test('stops when the tunnel cannot be created, and says to delete one of that name', () => {
    plan(inputs, { create: { status: 1, err: 'tunnel with name already exists\n', writes: undefined } })
    expect(run()).toBe(1)
    expect(steps()).toEqual(['login', 'create --credentials-file'])
    expect(printed.at(-1)).toMatch(/delete it under Networking → Tunnels and run setup again/)
  })

  // Run again with a host application: the tunnel is kept, the routed
  // hostname is not routed again, the new one is, and the configuration
  // now has both doors.
  test('keeps the tunnel and routes only the new hostname when run again', () => {
    writeFileSync(credentials(), JSON.stringify({ AccountTag: 'a'.repeat(32), TunnelSecret: SECRET, TunnelID: ID }))
    writeFileSync(join(dir, 'config.yml'), ingressYaml(doors, inputs, ID))
    const both = { ...inputs, app: 'app.example.com' }
    plan(both)
    expect(run([...argv, '--app', 'app.example.com'])).toBe(0)
    expect(cloudflared.asked().filter((args) => args[1] === 'create' || (args[1] === 'route' && args[2] === 'dns'))).toEqual([['tunnel', 'route', 'dns', ID, 'app.example.com']])
    expect(routedHostnames(readFileSync(join(dir, 'config.yml'), 'utf8'))).toEqual(['formancy.example.com', 'app.example.com'])
  })

  // An existing DNS record is never overwritten: setup stops before it
  // writes a configuration for a hostname that does not lead to the tunnel.
  test('stops at a hostname it cannot route, never overwriting a record, and writes no configuration', () => {
    plan({ ...inputs, app: 'app.example.com' }, { 'route app.example.com': { status: 1, err: 'An A, AAAA, or CNAME record with that host already exists.\n' } })
    expect(run([...argv, '--app', 'app.example.com'])).toBe(1)
    expect(cloudflared.asked().some((args) => args.includes('--overwrite-dns'))).toBe(false)
    expect(existsSync(join(dir, 'config.yml'))).toBe(false)
    expect(printed.at(-1)).toMatch(/delete it or choose another hostname, then run setup again: setup never overwrites a record\. formancy\.example\.com was routed by this run and stays routed\./)
  })
})
