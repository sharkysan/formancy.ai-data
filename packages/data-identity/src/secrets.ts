import { readFile } from 'node:fs/promises'
import { isAbsolute } from 'node:path'

/**
 * Where a secret comes from: injected, so a test can supply an environment and
 * a file system without touching the process's own.
 */
export interface SecretSource {
  env: Readonly<Record<string, string | undefined>>
  readFile(path: string): Promise<string>
}

const DEFAULT_SOURCE: SecretSource = {
  env: process.env,
  readFile: (path) => readFile(path, 'utf8'),
}

const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/

/**
 * The value behind a secret reference.
 *
 * Configuration names a secret, never contains one (plan section 3: "a
 * server-side secret reference"). Two forms: `env:NAME`, read from the
 * environment, and `file:/absolute/path`, read from a file — which is how
 * Docker and Kubernetes hand secrets to a container.
 *
 * **No error message ever contains the reference's value**, only its form. The
 * commonest mistake is pasting the secret itself where its reference belongs,
 * and an error that echoed the input would print the secret into a log.
 */
export async function resolveSecret(reference: string, source: SecretSource = DEFAULT_SOURCE): Promise<string> {
  if (reference.startsWith('env:')) {
    const name = reference.slice(4)
    if (!ENV_NAME.test(name)) throw new Error('an env: secret reference names a variable in upper case, digits and underscores')
    const value = source.env[name]
    if (value === undefined || value === '') throw new Error(`the environment variable ${name} is unset or empty`)
    return value
  }

  if (reference.startsWith('file:')) {
    const path = reference.slice(5)
    if (!isAbsolute(path)) throw new Error('a file: secret reference needs an absolute path')
    let text: string
    try {
      text = await source.readFile(path)
    } catch {
      throw new Error(`the secret file ${path} cannot be read`)
    }
    // One trailing newline is how most tools write a file; a secret that
    // really ends in one is not something anybody types.
    const value = text.endsWith('\r\n') ? text.slice(0, -2) : text.endsWith('\n') ? text.slice(0, -1) : text
    if (value === '') throw new Error(`the secret file ${path} is empty`)
    return value
  }

  throw new Error('a secret reference is env:NAME or file:/absolute/path. If you pasted the secret itself here, move it into one of those instead.')
}
