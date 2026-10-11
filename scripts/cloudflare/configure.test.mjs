import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { configure } from '../../deploy/cloudflare/configure.mjs'
import { ingressYaml, probes } from '../../deploy/cloudflare/ingress.mjs'
import { standIn } from './stand-in.mjs'

/**
 * deploy/cloudflare/configure.mjs's steps (0037), against a stand-in for
 * cloudflared that answers as each case says: the configuration in use is
 * replaced only when cloudflared calls the new one valid and matches every
 * probe to the rule doors.json gives, and otherwise stays as it was; both
 * files end readable by their owner alone; the tunnel's secret is printed
 * nowhere. Run as the test's user, not root, so nothing is chowned here; the
 * CI job `cloudflare` runs configure in the tools image as root, with the real
 * binary, and checks the owner is cloudflared's.
 */
const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const doors = JSON.parse(readFileSync(join(repo, 'deploy', 'cloudflare', 'doors.json'), 'utf8'))
const ID = '6ff42ae2-765d-4adf-8112-31c55c1551ef'
const SECRET = 'c3RhbmQtaW4gc2VjcmV0IHRoYXQgbXVzdCBub3QgYmUgcHJpbnRlZA=='
const inputs = { admin: 'formancy.example.com', team: 'example-team', aud: '0123456789abcdef'.repeat(4), app: 'app.example.com' }

let dir
let cloudflared
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'formancy-data-configure-'))
  cloudflared = standIn(dir)
  writeFileSync(join(dir, 'credentials.json'), JSON.stringify({ AccountTag: 'a'.repeat(32), TunnelSecret: SECRET, TunnelID: ID }))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const next = () => join(dir, 'config.yml.new')
/** `--version`, `ingress validate` answered with `validate`, and every probe with the rule doors.json expects, or `wrong` gives. */
function plan({ validate = { out: 'Validating rules from x\nOK\n' }, wrong = {} } = {}) {
  cloudflared.plan([
    { args: ['--version'], out: 'cloudflared version 2026.10.0 (stand-in)\n' },
    { args: ['tunnel', '--config', next(), 'ingress', 'validate'], ...validate },
    ...probes(doors, inputs).map((probe) => ({ args: ['tunnel', '--config', next(), 'ingress', 'rule', probe.url], out: `Using rules from x\nMatched rule #${String(wrong[probe.url] ?? probe.rule)}\n` })),
  ])
}
const run = () => configure({ inputs, doors, dir, cloudflared: cloudflared.binary, owner: null })
const mode = (file) => (statSync(join(dir, file)).mode & 0o777).toString(8)

describe('configure', () => {
  // The file cloudflared runs is the one checked: valid, then every probe
  // asked of that very file. Only then is it moved into place, readable by
  // its owner alone, like the credentials.
  test('writes the configuration once cloudflared calls it valid and every probe matches', () => {
    plan()
    const result = run()
    expect(result.ok).toBe(true)
    expect(readFileSync(join(dir, 'config.yml'), 'utf8')).toBe(ingressYaml(doors, inputs, ID))
    expect([mode('config.yml'), mode('credentials.json')]).toEqual(['400', '400'])
    expect(existsSync(join(dir, 'config.yml.new'))).toBe(false)
    const asked = cloudflared.asked()
    expect(asked.find((args) => args.includes('validate'))).toEqual(['tunnel', '--config', next(), 'ingress', 'validate'])
    expect(asked.filter((args) => args.includes('rule')).map((args) => args.at(-1))).toEqual(probes(doors, inputs).map((probe) => probe.url))
    expect(asked.every((args) => !args.includes('rule') || args[2] === next())).toBe(true)
    expect(result.lines.join('\n')).not.toContain(SECRET)
  })

  // One probe matched to another rule is a door that does not do what
  // doors.json says -- here the runtime door taking an administrator's
  // route. The file in use stays, and the sentence names the URL.
  test('keeps the configuration in use when one probe matches another rule', () => {
    writeFileSync(join(dir, 'config.yml'), 'the one in use\n')
    plan({ wrong: { 'https://app.example.com/v1/connections': 1 } })
    const result = run()
    expect(result.ok).toBe(false)
    expect(result.lines.join('\n')).toMatch(/https:\/\/app\.example\.com\/v1\/connections matched rule #1 under cloudflared, where it must match rule #2/)
    expect(result.lines.at(-1)).toMatch(/was left as it was/)
    expect(readFileSync(join(dir, 'config.yml'), 'utf8')).toBe('the one in use\n')
    expect(existsSync(join(dir, 'config.yml.new'))).toBe(false)
  })

  // cloudflared's own refusal is the last word: no probe is asked of a file
  // it cannot read.
  test('keeps the configuration in use when cloudflared refuses it', () => {
    writeFileSync(join(dir, 'config.yml'), 'the one in use\n')
    plan({ validate: { status: 1, err: 'error parsing ingress rules\n' } })
    const result = run()
    expect(result.ok).toBe(false)
    expect(result.lines[0]).toMatch(/cloudflared refused the configuration it would run: error parsing ingress rules/)
    expect(readFileSync(join(dir, 'config.yml'), 'utf8')).toBe('the one in use\n')
    expect(cloudflared.asked().some((args) => args.includes('rule'))).toBe(false)
  })

  // Run again with fewer arguments than before -- the guide's shape (b)
  // command followed on shape (a) -- the configuration would lose the host
  // application's own service on its hostname, which goes dark, and nothing
  // would say why: configure remembers no earlier argument. So a door the
  // configuration in use opens goes only when --drop names its hostname,
  // and otherwise nothing is written and cloudflared is asked nothing.
  test('refuses to remove a door the configuration in use opens, unless --drop names its hostname', () => {
    const shapeA = { ...inputs, appService: 'http://hostapp:3000' }
    writeFileSync(join(dir, 'config.yml'), ingressYaml(doors, shapeA, ID))
    plan()
    const refused = run()
    expect(refused.ok).toBe(false)
    expect(refused.lines.join('\n')).toMatch(/sends every other path of app\.example\.com to the host application’s own service, and these arguments would not/)
    expect(refused.lines.join('\n')).toMatch(/give the arguments setup was given, or add --drop app\.example\.com/)
    expect(readFileSync(join(dir, 'config.yml'), 'utf8')).toBe(ingressYaml(doors, shapeA, ID))
    expect(cloudflared.asked()).toEqual([])
    const dropped = configure({ inputs: { ...inputs, drop: 'app.example.com' }, doors, dir, cloudflared: cloudflared.binary, owner: null })
    expect(dropped.ok).toBe(true)
    expect(readFileSync(join(dir, 'config.yml'), 'utf8')).toBe(ingressYaml(doors, inputs, ID))
  })

  // A --drop that removes nothing is a mistaken hostname, said rather than
  // ignored; so is an administrator's hostname changed without one.
  test('refuses a --drop that removes nothing, and a changed administrator’s hostname without one', () => {
    writeFileSync(join(dir, 'config.yml'), ingressYaml(doors, inputs, ID))
    plan()
    const nothing = configure({ inputs: { ...inputs, drop: 'other.example.com' }, doors, dir, cloudflared: cloudflared.binary, owner: null })
    expect(nothing.ok).toBe(false)
    expect(nothing.lines.join('\n')).toMatch(/--drop other\.example\.com removes no door/)
    const moved = configure({ inputs: { ...inputs, admin: 'admin.example.com' }, doors, dir, cloudflared: cloudflared.binary, owner: null })
    expect(moved.ok).toBe(false)
    expect(moved.lines.join('\n')).toMatch(/opens formancy\.example\.com as the administrator’s door, and these arguments would not/)
    expect(cloudflared.asked()).toEqual([])
  })

  // Without credentials there is no tunnel; configure says what creates
  // one, and asks cloudflared nothing.
  test('says to run setup when there is no tunnel yet', () => {
    rmSync(join(dir, 'credentials.json'))
    plan()
    expect(run()).toEqual({ ok: false, lines: [expect.stringMatching(/does not exist, so there is no tunnel to configure: run tunnel-setup/)] })
    expect(cloudflared.asked()).toEqual([])
  })
})
