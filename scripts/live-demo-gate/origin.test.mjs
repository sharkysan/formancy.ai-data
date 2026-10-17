import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { PREFIX } from '../../apps/live-demo/dist/worker/pure.mjs'
import { routeOf } from './origin.mjs'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const config = JSON.parse(readFileSync(join(repo, 'apps', 'live-demo', 'wrangler.json'), 'utf8'))
const files = new Set(['/data/demo/index.html', '/data/demo/assets/index-abc123.js', '/data/demo/THIRD-PARTY-NOTICES.txt'])
// Files at the paths the Worker answers too: run_worker_first must win over a file, not only over a miss.
const shadowed = new Set([...files, '/data/demo/session', ...config.assets.run_worker_first.map((pattern) => pattern.replace('*', 'forms/order/records/list'))])
const route = (pathname, held = files) => routeOf(pathname, { prefix: PREFIX, assets: config.assets, exists: (path) => held.has(path) })

describe('the local origin, as wrangler.json has Cloudflare route the demo', () => {
  // Every pattern run_worker_first names reaches the Worker before the
  // assets are asked, even where the assets hold a file of that name: a
  // session or a runtime-plane request answered as a file would never
  // reach a visitor's server.
  test("sends every path run_worker_first names to the Worker first, read from the config", () => {
    expect(config.assets.run_worker_first.length).toBeGreaterThan(0)
    for (const pattern of config.assets.run_worker_first) expect(route(pattern.replace('*', 'forms/order/records/list'), shadowed), pattern).toEqual({ kind: 'worker' })
    expect(route('/data/demo/session', shadowed)).toEqual({ kind: 'worker' })
    expect(route('/data/demo/v1/forms')).toEqual({ kind: 'worker' })
  })

  // The page and its files come from the assets with no Worker and no
  // container (0070): free, instant, and under _headers.
  test('serves the page and its files from the assets, the directory as its index.html', () => {
    expect(route('/data/demo/')).toEqual({ kind: 'asset', file: '/data/demo/index.html' })
    expect(route('/data/demo/assets/index-abc123.js')).toEqual({ kind: 'asset', file: '/data/demo/assets/index-abc123.js' })
    expect(route('/data/demo/THIRD-PARTY-NOTICES.txt')).toEqual({ kind: 'asset', file: '/data/demo/THIRD-PARTY-NOTICES.txt' })
  })

  // not_found_handling "none" with a Worker: a miss runs the Worker, whose
  // 404 carries its own headers (0070). auto-trailing-slash: the path
  // without its slash, and an index.html by name, are sent to the directory.
  test('runs the Worker on an asset miss, and redirects as auto-trailing-slash does', () => {
    expect(config.assets.not_found_handling).toBe('none')
    expect(config.assets.html_handling).toBe('auto-trailing-slash')
    expect(route('/data/demo/nope.js')).toEqual({ kind: 'worker' })
    expect(route('/data/demo/v1')).toEqual({ kind: 'worker' })
    expect(route('/data/demo')).toEqual({ kind: 'redirect', location: '/data/demo/' })
    expect(route('/data/demo/index.html')).toEqual({ kind: 'redirect', location: '/data/demo/' })
  })

  // The routes are /data/demo and below: /data is formancy.ai's own site.
  test("leaves everything outside the demo's path to the site", () => {
    expect(route('/data')).toEqual({ kind: 'elsewhere' })
    expect(route('/data/demonstration')).toEqual({ kind: 'elsewhere' })
    expect(route('/')).toEqual({ kind: 'elsewhere' })
  })

  // A pattern this file cannot read the way Cloudflare does would be routed
  // wrongly in silence.
  test('refuses a negated pattern or a config holding something it does not model', () => {
    expect(() => routeOf('/data/demo/', { prefix: PREFIX, assets: { ...config.assets, run_worker_first: ['!/data/demo/x'] }, exists: () => false })).toThrow(/negated/)
    expect(() => routeOf('/data/demo/', { prefix: PREFIX, assets: { ...config.assets, html_handling: 'none' }, exists: () => false })).toThrow(/html_handling none/)
  })
})
