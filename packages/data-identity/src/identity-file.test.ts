import { execFileSync } from 'node:child_process'
import { createSecretKey, randomBytes } from 'node:crypto'
import type { KeyObject } from 'node:crypto'
import { closeSync, constants, openSync } from 'node:fs'
import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SignJWT } from 'jose'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createIdentityVerifier } from './identity.js'
import type { IdentityVerifier } from './identity.js'
import { openKeySetFile } from './identity-file.js'
import type { KeySetFile } from './identity-file.js'

/*
 * A key set file read at start and again when asked (0059): a valid set
 * replaces the one in force between tokens, with what changed named; and
 * anything else -- a file gone, unreadable, half-written or refused --
 * leaves the set in force exactly as it was, never wider and never empty.
 */

interface Held {
  kid: string
  key: KeyObject
  jwk: Record<string, unknown>
}
function hs(kid: string): Held {
  const bytes = randomBytes(32)
  return { kid, key: createSecretKey(bytes), jwk: { kty: 'oct', kid, k: bytes.toString('base64url') } }
}
const text = (...held: Held[]): string => JSON.stringify({ keys: held.map((entry) => entry.jwk) })

let directory: string
let path: string
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'formancy-data-keys-'))
  path = join(directory, 'keys.json')
})
afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

/** A file replaced the way an operator is told to: written beside it, then renamed over it. */
async function replace(content: string): Promise<void> {
  await writeFile(join(directory, 'next.json'), content)
  await rename(join(directory, 'next.json'), path)
}

function verifierOver(file: KeySetFile): Promise<IdentityVerifier> {
  return createIdentityVerifier({ key: { kind: 'key-set', keys: file.current }, issuer: 'https://host.example', audience: 'formancy-data', attributes: {} })
}

async function token(held: Held): Promise<string> {
  return new SignJWT({ sub: 'u' })
    .setProtectedHeader({ alg: 'HS256', kid: held.kid })
    .setIssuer('https://host.example')
    .setAudience('formancy-data')
    .setExpirationTime('5m')
    .sign(held.key)
}

describe('openKeySetFile', () => {
  // The rotation itself: the next token meets the set just read, and the log
  // line built from the outcome names what changed. A replaced key under the
  // same kid -- a rotated HS256 secret kept under its name -- is a change:
  // comparing kids alone would report it as nothing, and the operator's job
  // would read "nothing changed" over a key that did.
  test('a set read again is the one the next token meets, and what changed is named', async () => {
    const [a, b, c] = [hs('a'), hs('b'), hs('c')]
    await writeFile(path, text(a, b))
    const file = await openKeySetFile(path, 'HS256')
    const verify = await verifierOver(file)
    expect(await verify(await token(a))).toMatchObject({ ok: true })
    expect(await verify(await token(c))).toMatchObject({ ok: false })

    const a2 = { ...hs('a') }
    await replace(text(a2, c))
    expect(await file.readAgain()).toEqual({ read: true, changed: true, kids: ['a', 'c'], added: ['c'], removed: ['b'], replaced: ['a'], leftOut: [] })
    expect(await verify(await token(c))).toMatchObject({ ok: true })
    expect(await verify(await token(a2))).toMatchObject({ ok: true })
    expect(await verify(await token(a))).toMatchObject({ ok: false })
    expect(await verify(await token(b))).toMatchObject({ ok: false })

    expect(await file.readAgain()).toEqual({ read: true, changed: false, kids: ['a', 'c'], leftOut: [] })
  })

  // A set refused at start stops the process (data-server's main.ts): the
  // path is configuration and is named, as resolveSecret names a secret
  // file's.
  test('a file that cannot be read, or is refused, at start is a sentence', async () => {
    await expect(openKeySetFile(path, 'HS256')).rejects.toThrow(`the identity key set file ${path} cannot be read`)
    await writeFile(path, text({ ...hs('a'), jwk: { kty: 'oct', kid: 'a', k: 'c2hvcnQ' } }))
    await expect(openKeySetFile(path, 'HS256')).rejects.toThrow(/^key "a" is shorter than 32 bytes/)
  })

  // A typo, a half-written file or a deleted one must not turn into an
  // outage of every form, nor into a set wider than the operator last wrote
  // validly. The outcome says why, in readKeySet's sentence, so the log line
  // holds no text of the file.
  test('a file that is deleted, unreadable, malformed, empty or refused leaves the set in force', async () => {
    const [a, b] = [hs('a'), hs('b')]
    await writeFile(path, text(a))
    let unreadable = false
    const file = await openKeySetFile(path, 'HS256', async (target) => {
      if (unreadable) throw Object.assign(new Error(`EACCES: permission denied, open '${target}'`), { code: 'EACCES' })
      const { readFile } = await import('node:fs/promises')
      return readFile(target, 'utf8')
    })
    const verify = await verifierOver(file)

    const attempts: Array<{ why: string; act: () => Promise<void>; problem: RegExp }> = [
      { why: 'deleted', act: () => rm(path), problem: /cannot be read$/ },
      {
        why: 'unreadable',
        act: async () => {
          await writeFile(path, text(a, b))
          unreadable = true
        },
        problem: /cannot be read$/,
      },
      {
        why: 'malformed',
        act: async () => {
          unreadable = false
          await replace(`${text(a, b).slice(0, 40)}`)
        },
        problem: /^the identity key set file is not JSON$/,
      },
      { why: 'empty', act: () => replace(''), problem: /^the identity key set file is not JSON$/ },
      // A valid new key beside a refused one: taking the valid one would make
      // the set wider than any file the operator wrote validly.
      {
        why: 'refused',
        act: () => replace(text(b, { ...hs('x'), jwk: { kty: 'oct', kid: 'x', k: 'c2hvcnQ' } })),
        problem: /^key "x" is shorter than 32 bytes/,
      },
    ]
    for (const { why, act, problem } of attempts) {
      await act()
      const outcome = await file.readAgain()
      expect(outcome, why).toMatchObject({ read: false, kids: ['a'] })
      expect(outcome.read === false && outcome.problem, why).toMatch(problem)
      expect(await verify(await token(a)), why).toMatchObject({ ok: true })
      expect(await verify(await token(b)), why).toMatchObject({ ok: false })
    }
  })

  // The outcome's problem goes to the log. readKeySet's sentences hold no
  // text of the file; an error of any other kind -- one a later change to
  // the reading might throw, carrying what it read -- is logged as a fixed
  // sentence instead, and still leaves the set in force. KeySet is frozen,
  // so the fault is put into a fresh copy of the module, not spied on.
  test('a read that fails other than by a refusal is a fixed sentence, and leaves the set in force', async () => {
    const a = hs('a')
    await writeFile(path, text(a))
    const material = randomBytes(32).toString('base64url')
    let reads = 0
    vi.resetModules()
    vi.doMock('./identity-keys.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('./identity-keys.js')>()
      return {
        ...actual,
        readKeySet: (...args: Parameters<typeof actual.readKeySet>) => {
          reads++
          if (reads > 1) throw new Error(material)
          return actual.readKeySet(...args)
        },
      }
    })
    try {
      const { openKeySetFile: open } = await import('./identity-file.js')
      const file = await open(path, 'HS256')
      expect(await file.readAgain()).toEqual({ read: false, kids: ['a'], problem: 'the identity key set file could not be read as a key set' })
      expect(file.current().kids).toEqual(['a'])
      expect(reads).toBe(2)
    } finally {
      vi.doUnmock('./identity-keys.js')
      vi.resetModules()
    }
  })

  // A read that never finished would hold the queue below: every later
  // SIGHUP would log nothing, the set in force would never change, and
  // SIGTERM would wait behind it. A FIFO at the path blocked readFile until
  // a writer opened it. Anything but a regular file is refused at once, at
  // start and when read again, and the next read reads. The two seconds are
  // a bound on a read that takes milliseconds; past them the FIFO is opened
  // for writing, so a reader stuck on it ends and the suite does not hang.
  test('a path that is not a regular file is refused at once, and the next read still reads', async () => {
    if (process.platform === 'win32') return
    const [a, b] = [hs('a'), hs('b')]
    const fifo = join(directory, 'fifo.json')
    execFileSync('mkfifo', [fifo])
    const atOnce = async <T>(pending: Promise<T>): Promise<T | 'blocked'> => {
      let timer: NodeJS.Timeout | undefined
      const blocked = new Promise<'blocked'>((resolve) => {
        timer = setTimeout(() => resolve('blocked'), 2000)
      })
      const outcome = await Promise.race([pending, blocked])
      clearTimeout(timer)
      if (outcome === 'blocked') {
        closeSync(openSync(fifo, constants.O_WRONLY | constants.O_NONBLOCK))
        await pending.catch(() => undefined)
      }
      return outcome
    }
    const notRegular = `the identity key set file ${fifo} is not a regular file`
    expect(
      await atOnce(
        openKeySetFile(fifo, 'HS256').then(
          () => 'read',
          (error: unknown) => (error instanceof Error ? error.message : 'thrown'),
        ),
      ),
    ).toBe(notRegular)

    await writeFile(path, text(a))
    const file = await openKeySetFile(path, 'HS256')
    await rm(path)
    await rename(fifo, path)
    const swapped = notRegular.replace(fifo, path)
    expect(await atOnce(file.readAgain())).toEqual({ read: false, kids: ['a'], problem: swapped })
    expect(await atOnce(file.readAgain())).toEqual({ read: false, kids: ['a'], problem: swapped })
    await rm(path)
    await writeFile(path, text(a, b))
    expect(await atOnce(file.readAgain())).toMatchObject({ read: true, kids: ['a', 'b'], added: ['b'] })
  })

  // Two signals close together are two reads. If a slow first read finished
  // after a quick second one, the set in force would be the older file's,
  // and the last line in the log would say otherwise.
  test('reads run one at a time, in the order they were asked for', async () => {
    const [a, b, c] = [hs('a'), hs('b'), hs('c')]
    const answers = [text(a), text(a, b), text(c)]
    const releases: Array<() => void> = []
    let reads = 0
    const file = await openKeySetFile(path, 'HS256', async () => {
      const answer = answers[reads] as string
      reads++
      if (reads === 1) return answer
      // The first read again waits until it is let go; the second does not.
      if (reads === 2) await new Promise<void>((resolve) => releases.push(resolve))
      return answer
    })
    const first = file.readAgain()
    const second = file.readAgain()
    await new Promise((resolve) => setTimeout(resolve, 20))
    for (const release of releases) release()
    expect(await first).toMatchObject({ read: true, kids: ['a', 'b'] })
    expect(await second).toMatchObject({ read: true, kids: ['c'], removed: ['a', 'b'] })
    expect(file.current().kids).toEqual(['c'])
  })
})
