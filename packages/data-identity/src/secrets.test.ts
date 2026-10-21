import { describe, expect, test } from 'vitest'
import type { SecretSource } from './secrets.js'
import { resolveSecret } from './secrets.js'

const SECRET = 's3cr3t-value-that-must-never-be-printed'

function source(env: Record<string, string>, files: Record<string, string> = {}): SecretSource {
  return {
    env,
    readFile: async (path) => {
      const text = files[path]
      if (text === undefined) throw new Error(`ENOENT ${path}`)
      return text
    },
  }
}

/** The error's message, which must never contain the secret. */
async function failure(reference: string, from: SecretSource): Promise<string> {
  try {
    await resolveSecret(reference, from)
  } catch (error) {
    return (error as Error).message
  }
  throw new Error('expected a failure')
}

describe('resolveSecret', () => {
  // The two supported references, and the one trailing newline a file usually has.
  test('reads env: and file: references', async () => {
    expect(await resolveSecret('env:DB_PASSWORD', source({ DB_PASSWORD: SECRET }))).toBe(SECRET)
    expect(await resolveSecret('file:/run/secrets/db', source({}, { '/run/secrets/db': `${SECRET}\n` }))).toBe(SECRET)
    expect(await resolveSecret('file:/run/secrets/db', source({}, { '/run/secrets/db': `${SECRET}\r\n` }))).toBe(SECRET)
  })

  // The commonest mistake is pasting the secret where its reference belongs.
  // An error that echoed its input would print the secret into a log.
  test('refuses anything else without repeating it', async () => {
    const message = await failure(SECRET, source({}))
    expect(message).toMatch(/env:NAME or file:/)
    expect(message).not.toContain(SECRET)
  })

  // An unset variable is an empty password, which some drivers accept. It is
  // refused by name, so the operator knows which one.
  test('refuses an unset or empty variable, naming the variable and not a value', async () => {
    expect(await failure('env:DB_PASSWORD', source({}))).toBe('the environment variable DB_PASSWORD is unset or empty')
    expect(await failure('env:DB_PASSWORD', source({ DB_PASSWORD: '' }))).toMatch(/unset or empty/)
    expect(await failure('env:db password', source({}))).toMatch(/upper case/)
  })

  // A relative path resolves against wherever the process happened to start.
  test('refuses a relative path, a missing file and an empty one', async () => {
    expect(await failure('file:secrets/db', source({}))).toMatch(/absolute path/)
    expect(await failure('file:/run/secrets/nope', source({}))).toBe('the secret file /run/secrets/nope cannot be read')
    expect(await failure('file:/run/secrets/db', source({}, { '/run/secrets/db': '\n' }))).toMatch(/is empty/)
  })
})
