import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import YAML from 'yaml'
import { believedProblems, trustProblems } from './trust.mjs'

/**
 * Whom the composed stack's server trusts as a proxy (0071), held without
 * Docker: compose.yaml and the Cloudflare overlay as committed, and each
 * edit away from them that would leave every client in one proxy's bucket
 * or let a client choose its own address. The gates run the same checks on
 * what Compose itself resolves, and the getting-started gate reads the
 * server's log for what it believed.
 */
const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (path) => readFileSync(join(repo, path), 'utf8')

/** compose.yaml as parsed, and with the overlay's services added, which is all the overlay adds. */
function committed({ overlay = false } = {}) {
  const base = YAML.parse(read('compose.yaml'), { merge: true })
  if (overlay) Object.assign(base.services, YAML.parse(read('deploy/cloudflare/compose.yaml')).services)
  return base
}

const SERVER = 'FORMANCY_DATA_TRUSTED_PROXIES'

/** The committed configuration with the server trusting `list`. */
function trusting(list, config = committed()) {
  config.services.server.environment[SERVER] = list
  return config
}

describe('the proxies the server trusts, in the configuration', () => {
  // The baseline every case below is one edit away from: the server trusts
  // the web front's address on `proxy` and cloudflared's on `edge`, each
  // outside what Docker hands out, alone and with the overlay that gives
  // cloudflared its address. A check that refused the stack as it is would
  // fail every run and be switched off.
  test('passes compose.yaml as committed, alone and with the Cloudflare overlay', () => {
    expect(trustProblems(committed())).toEqual([])
    expect(trustProblems(committed({ overlay: true }))).toEqual([])
  })

  // Each edit leaves every client counted in one proxy's bucket again: the
  // server not naming nginx, nginx with no fixed address to name, and, with
  // the overlay, cloudflared with none or one the server does not name.
  // Watched failing with each of the three checks removed in turn.
  test('refuses a stack in which a proxy cannot be named, or is not', () => {
    expect(trustProblems(trusting('172.16.239.250'))).toEqual(["the server's FORMANCY_DATA_TRUSTED_PROXIES does not name the web front's address, so every client shares nginx's one bucket"])
    const unpinned = committed()
    unpinned.services.web.networks = ['proxy', 'edge']
    expect(trustProblems(unpinned)).toEqual(["the web front holds no fixed address on a network it shares with the server, so the server cannot name it and every client shares nginx's one bucket"])
    const loose = committed({ overlay: true })
    loose.services.cloudflared.networks = ['edge']
    expect(trustProblems(loose)).toEqual(["cloudflared holds no fixed address the server trusts on the network it shares with the web front, so behind the tunnel every visitor shares cloudflared's one bucket"])
    expect(trustProblems(trusting('172.16.238.250', committed({ overlay: true })))).toEqual([
      "cloudflared holds no fixed address the server trusts on the network it shares with the web front, so behind the tunnel every visitor shares cloudflared's one bucket",
    ])
  })

  // Each edit lets a client choose its own address. A range takes in the
  // network's gateway, which is where a local process on a Linux host
  // reaches a container from, past nginx; the gateway itself is the same;
  // an address in the part Docker hands out can be given to any container
  // the next start makes; one in no network of the file is held by whoever
  // takes it; and a service that is no proxy holding the address speaks for
  // whoever reaches it. Watched failing with each rule removed in turn.
  test.each([
    ['a range', '172.16.238.250,172.16.238.0/24', ["the server's FORMANCY_DATA_TRUSTED_PROXIES entry 2 is not one IPv4 address: a range takes in its network's gateway, from where any local process reaches a container and could choose its own address"]],
    ['the gateway', '172.16.238.250,172.16.238.1', ["the server's FORMANCY_DATA_TRUSTED_PROXIES entry 2 is the gateway of proxy, from where any local process reaches its containers", "the server's FORMANCY_DATA_TRUSTED_PROXIES entry 2 is in the part of proxy Docker hands out, so another container could be given it"]],
    ['an address Docker hands out', '172.16.238.250,172.16.239.7', ["the server's FORMANCY_DATA_TRUSTED_PROXIES entry 2 is in the part of edge Docker hands out, so another container could be given it"]],
    ['an address in no network of the file', '172.16.238.250,10.9.9.9', ["the server's FORMANCY_DATA_TRUSTED_PROXIES entry 2 is in no network of the file with a fixed range, so nothing says who holds it"]],
  ])('refuses %s', (_, list, problems) => {
    expect(trustProblems(trusting(list))).toEqual(problems)
  })

  test('refuses a service that is no proxy holding a trusted address', () => {
    const config = committed()
    config.services.postgres.networks = { default: null, edge: { ipv4_address: '172.16.239.250' } }
    expect(trustProblems(config)).toEqual(["postgres holds the address of the server's FORMANCY_DATA_TRUSTED_PROXIES entry 2, and is no proxy"])
  })

  // Without both services there is nothing to hold, and saying nothing would
  // read as passing.
  test('says so when there is no server or no web front', () => {
    const config = committed()
    delete config.services.web
    expect(trustProblems(config)).toEqual(['the configuration has no server or no web front, so whom the server trusts cannot be read'])
  })
})

describe("what the server's log says it believed", () => {
  const config = committed()
  const line = (remoteAddress) => JSON.stringify({ level: 30, msg: 'incoming request', req: { method: 'GET', route: '/v1/forms', remoteAddress } })

  // Through nginx the server logs the address nginx saw -- the gateway of
  // `proxy` for a browser on the machine, 127.0.0.1 for the web front's own
  // health check -- and never nginx's own, which it logs only for a request
  // it did not believe nginx about. Other lines are not requests. A log
  // with no request line is no evidence either way. Watched failing with
  // the comparison removed (the second case passed) and with an empty log
  // taken as passing.
  test("passes addresses nginx saw, and refuses the web front's own or none at all", () => {
    expect(believedProblems([line('172.16.238.1'), line('127.0.0.1'), '{"level":30,"msg":"planes"}', 'not json'].join('\n'), config)).toEqual([])
    expect(believedProblems([line('172.16.238.1'), line('172.16.238.250'), line('172.16.238.250')].join('\n'), config)).toEqual(["2 of the 3 requests in the server's log name the web front's own address"])
    expect(believedProblems('{"level":30,"msg":"planes"}\n', config)).toEqual(["the server's log names no request, so whom it believed cannot be read"])
  })
})
