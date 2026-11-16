import type { SaveBody, SaveChange, SaveRecordChange } from '@formancy/data-core'

/*
 * What `POST /v1/forms/:id/records/save` takes (0155), checked before
 * anything else: a 400 for a body of another shape, before the write id is
 * read or any bundle loaded. Only what the shape names is carried on, so a
 * key the body adds travels nowhere.
 */

/** A new row's ref: what the page minted for it, echoed in the answer and nowhere else -- no statement, no log line, no audit event. */
const REF = /^[A-Za-z0-9_-]{1,32}$/

export type ShapedSave = { ok: true; body: SaveBody; changes: number } | { ok: false; code: 'invalid-request' | 'nothing-to-update'; message: string }

const EXPECTED =
  'Expected { record: { create: { answers } } or { update: { record, version, answers } }, rows: [{ form, field, changes: [{ create: { ref, answers } } or { update: { record, version, answers } } or { delete: { record, version } }] }] }.'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The one key of `value`, or `undefined` where it has none or more: a record and a change are each exactly one of their kinds. */
function onlyKey(value: unknown): { key: string; inner: Record<string, unknown> } | undefined {
  if (!isRecord(value)) return undefined
  const keys = Object.keys(value)
  const [key] = keys
  const inner = key === undefined ? undefined : value[key]
  return keys.length === 1 && key !== undefined && isRecord(inner) ? { key, inner } : undefined
}

/** A located row's token and the version its person read, or `undefined`. */
function located(inner: Record<string, unknown>): { record: string; version: string } | undefined {
  const { record, version } = inner
  return typeof record === 'string' && typeof version === 'string' ? { record, version } : undefined
}

function recordOf(value: unknown): SaveRecordChange | undefined {
  const one = onlyKey(value)
  if (one === undefined || !isRecord(one.inner['answers'])) return undefined
  const answers = one.inner['answers']
  if (one.key === 'create') return { create: { answers } }
  const at = located(one.inner)
  return one.key === 'update' && at !== undefined ? { update: { ...at, answers } } : undefined
}

function changeOf(value: unknown): SaveChange | 'ref' | undefined {
  const one = onlyKey(value)
  if (one === undefined) return undefined
  const { key, inner } = one
  if (key === 'create') {
    const { ref, answers } = inner
    if (typeof ref !== 'string' || !REF.test(ref)) return 'ref'
    return isRecord(answers) ? { create: { ref, answers } } : undefined
  }
  const at = located(inner)
  if (at === undefined) return undefined
  if (key === 'delete') return { delete: at }
  return key === 'update' && isRecord(inner['answers']) ? { update: { ...at, answers: inner['answers'] } } : undefined
}

/**
 * The body as a save, or why it is not one (0155):
 *
 * - the record is a create or an update, and each change a create, an
 *   update or a delete, each exactly one of them;
 * - a new row's ref is 1 to 32 letters, digits, `-` or `_`, and appears once
 *   in the body; a row's token appears once in its child; each child, by
 *   form and field, appears once;
 * - something is saved: a change to a row, a record created, or a record
 *   update that names an answer -- otherwise `nothing-to-update`, as an
 *   empty update alone is.
 *
 * `changes` counts the row changes, which the audit records and nothing
 * else of them.
 */
export function saveBodyOf(value: unknown): ShapedSave {
  const refused = (message: string = EXPECTED): ShapedSave => ({ ok: false, code: 'invalid-request', message })
  if (!isRecord(value) || !Array.isArray(value['rows'])) return refused()
  const record = recordOf(value['record'])
  if (record === undefined) return refused()
  const refs = new Set<string>()
  const children = new Set<string>()
  const rows: SaveBody['rows'] = []
  let count = 0
  for (const entry of value['rows'] as unknown[]) {
    if (!isRecord(entry) || typeof entry['form'] !== 'string' || typeof entry['field'] !== 'string' || !Array.isArray(entry['changes'])) return refused()
    const { form, field } = entry
    const name = `${form}\u0000${field}`
    if (children.has(name)) return refused(`${form} is named twice through ${field}.`)
    children.add(name)
    const tokens = new Set<string>()
    const changes: SaveChange[] = []
    for (const sent of entry['changes'] as unknown[]) {
      const change = changeOf(sent)
      if (change === 'ref') return refused("A new row's ref is 1 to 32 letters, digits, - or _.")
      if (change === undefined) return refused()
      const named = 'create' in change ? change.create.ref : 'update' in change ? change.update.record : change.delete.record
      const seen = 'create' in change ? refs : tokens
      if (seen.has(named)) return refused('create' in change ? 'A ref names one new row of the save.' : `${form} names one of its rows twice.`)
      seen.add(named)
      changes.push(change)
    }
    count += changes.length
    rows.push({ form, field, changes })
  }
  if ('update' in record && Object.keys(record.update.answers).length === 0 && count === 0) {
    return { ok: false, code: 'nothing-to-update', message: 'The save changes nothing: no answer of the record and no row.' }
  }
  return { ok: true, body: { record, rows }, changes: count }
}
