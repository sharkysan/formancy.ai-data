import type { DriftChange, DriftReport, DriftSubject } from '@formancy/data-core'
import { CONFIGURATION_ID } from './config-store.js'

/**
 * The drift check a deploy pipeline runs once its migrations are applied
 * (0111), shipped beside the server as `dist/drift-check-cli.mjs`:
 *
 *   drift-check-cli.mjs [--fail-on blocking|review] <server URL> <form id>...
 *
 * For each form it asks the administrator's plane `POST /v1/forms/:id/drift`
 * -- the published version against the database as the server's connection
 * finds it now (0010) -- and prints the report: one line a form, then a line
 * a change, most severe first as the server orders them. The administrator's
 * token is `FORMANCY_DATA_ADMIN_TOKEN`, never an argument, which a process
 * list and a CI log would show; nothing printed repeats it.
 *
 * Its exit status is the pipeline's answer: 0 when no form has a change it
 * fails on -- `blocking` by default, `review` too with `--fail-on review` --
 * 1 when one has, and 2 when a form could not be checked at all: unreachable,
 * refused, unknown, or answered with something that is not a report. A form
 * that could not be checked is never taken for one without drift.
 */

export interface DriftCheckIo {
  stdout(text: string): void
  stderr(text: string): void
  fetch: typeof fetch
}

export const DRIFT_CHECK_USAGE =
  'Usage: drift-check-cli.mjs [--fail-on blocking|review] <server URL> <form id>...\n' +
  'The administrator token is read from FORMANCY_DATA_ADMIN_TOKEN.'

/** What failing on a severity means: the severities that fail the check. */
const FAILS: Readonly<Record<'blocking' | 'review', ReadonlySet<DriftChange['severity']>>> = {
  blocking: new Set(['blocking']),
  review: new Set(['blocking', 'review']),
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Whether a 200's body is a drift report this tool can read: its changes, each with a severity, a kind, a subject and a message, and `blocking`. */
function isReport(body: unknown): body is DriftReport & { version: number } {
  if (!isRecord(body) || typeof body['blocking'] !== 'boolean' || typeof body['version'] !== 'number' || !Array.isArray(body['changes'])) return false
  return body['changes'].every(
    (change: unknown) =>
      isRecord(change) && typeof change['kind'] === 'string' && typeof change['message'] === 'string' && isRecord(change['subject']) && ['blocking', 'review', 'info'].includes(change['severity'] as string),
  )
}

/** What a change is about, as a person reads a table and a column: `sales.order.notes`. */
function subjectOf(subject: DriftSubject): string {
  switch (subject.kind) {
    case 'scope':
      return 'the scope'
    case 'schema':
      return subject.schema
    case 'object':
      return `${subject.object.schema}.${subject.object.name}`
    default:
      return `${subject.object.schema}.${subject.object.name}.${subject.name}`
  }
}

/** One report as the lines a log shows: the form, its version and its count, then each change. */
function reportLines(form: string, report: DriftReport & { version: number }, fails: ReadonlySet<DriftChange['severity']>): string {
  const failing = report.changes.filter((change) => fails.has(change.severity)).length
  const counted = report.changes.length === 0 ? 'no changes' : `${String(report.changes.length)} ${report.changes.length === 1 ? 'change' : 'changes'}, ${String(failing)} failing the check`
  const lines = [`${form} (version ${String(report.version)}): ${counted}`]
  for (const change of report.changes) lines.push(`  ${change.severity.padEnd(8)} ${change.kind} ${subjectOf(change.subject)}: ${change.message}`)
  return `${lines.join('\n')}\n`
}

/** The arguments, read: the severity failed on, the server and the forms -- or the sentence that says what is wrong. */
function readArguments(argv: readonly string[]): { ok: true; failOn: 'blocking' | 'review'; server: URL; forms: string[] } | { ok: false; problem: string } {
  let failOn: 'blocking' | 'review' = 'blocking'
  const rest = [...argv]
  if (rest[0] === '--fail-on') {
    const value = rest[1]
    if (value !== 'blocking' && value !== 'review') return { ok: false, problem: '--fail-on takes blocking or review.' }
    failOn = value
    rest.splice(0, 2)
  }
  const [address, ...forms] = rest
  if (address === undefined || forms.length === 0) return { ok: false, problem: 'Name the server and at least one form.' }
  let server: URL
  try {
    server = new URL(address)
  } catch {
    return { ok: false, problem: 'The server is a URL, http or https.' }
  }
  if (server.protocol !== 'http:' && server.protocol !== 'https:') return { ok: false, problem: 'The server is a URL, http or https.' }
  const unnamed = forms.find((form) => !CONFIGURATION_ID.test(form))
  if (unnamed !== undefined) return { ok: false, problem: 'A form id is lower-case letters, digits, dots, hyphens and underscores, starting with a letter or a digit.' }
  return { ok: true, failOn, server, forms }
}

/** The tool's exit status for `argv` (without node and the script). */
export async function runDriftCheck(argv: readonly string[], env: Readonly<Record<string, string | undefined>>, io: DriftCheckIo): Promise<number> {
  const read = readArguments(argv)
  const token = env['FORMANCY_DATA_ADMIN_TOKEN']
  if (!read.ok || token === undefined || token === '') {
    io.stderr(`${read.ok ? 'FORMANCY_DATA_ADMIN_TOKEN holds no token.' : read.problem}\n${DRIFT_CHECK_USAGE}\n`)
    return 2
  }
  const fails = FAILS[read.failOn]
  let failed = 0
  let unchecked = 0
  for (const form of read.forms) {
    const url = new URL(`v1/forms/${form}/drift`, read.server.href.endsWith('/') ? read.server : new URL(`${read.server.href}/`))
    let answer: Response
    try {
      answer = await io.fetch(url, { method: 'POST', headers: { authorization: `Bearer ${token}` } })
    } catch (error) {
      io.stderr(`${form}: ${read.server.origin} could not be reached: ${error instanceof Error ? error.message : 'no answer'}\n`)
      unchecked += 1
      continue
    }
    const body: unknown = await answer.json().catch(() => undefined)
    if (answer.status === 200 && isReport(body)) {
      io.stdout(reportLines(form, body, fails))
      if (body.changes.some((change) => fails.has(change.severity))) failed += 1
      continue
    }
    const said = isRecord(body) && typeof body['code'] === 'string' ? ` ${body['code']}${typeof body['message'] === 'string' ? `: ${body['message']}` : ''}` : ''
    io.stderr(`${form}: the server answered ${String(answer.status)}${said}${answer.status === 200 ? ', which is not a drift report' : ''}\n`)
    unchecked += 1
  }
  const checked = read.forms.length - unchecked
  io.stdout(`${String(checked)} of ${String(read.forms.length)} ${read.forms.length === 1 ? 'form' : 'forms'} checked; ${String(failed)} with a change failing on ${read.failOn}.\n`)
  return unchecked > 0 ? 2 : failed > 0 ? 1 : 0
}
