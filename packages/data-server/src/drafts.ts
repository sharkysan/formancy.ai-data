import type { ReassignedKey } from '@formancy/data-core'
import { validateBundle } from './bundle.js'
import type { BundleV2 } from './bundle.js'
import { UnparsableVersionError } from './config-store.js'
import type { ConfigurationStore } from './config-store.js'
import { readKeysConfirmed } from './reassigned.js'

/*
 * Drafts under review (0065): what an administrator submitted for a
 * publisher to approve, kept beside the versions in a store of its own
 * (`ConfigurationStore.drafts`, `<store>/.drafts`). Each form's drafts are
 * numbered entries written by that store's compare-and-swap, and never
 * edited, as versions are not:
 *
 *   { entry: 'draft', expectedBase, bundle, keysConfirmed, submittedBy }
 *   { entry: 'rejection', draft, by }
 *
 * A draft's number is its entry's. Its state is derived whenever it is
 * read, never written: published when the version after its base is its
 * bundle, rejected when a rejection names it, stale when another version
 * replaced its base, pending otherwise. Published is asked first, since it
 * is what is served: a rejection that landed while the approval wrote the
 * version is kept, and decides nothing. The version an approval writes is
 * the bundle alone; who approved it is the audit trail's (0033).
 */

/** A draft as its entry holds it. */
export interface DraftEntry {
  entry: 'draft'
  /** The version it changes, or `null` for a form's first. */
  expectedBase: number | null
  bundle: BundleV2
  /** The reassigned keys its author confirmed (0039), as a publish confirms them. */
  keysConfirmed: ReassignedKey[]
  /** The token's subject that submitted it: never a body's word. */
  submittedBy: string
}

/** A draft rejected, or withdrawn when `by` is its submitter. */
export interface RejectionEntry {
  entry: 'rejection'
  draft: number
  by: string
}

export type DraftState = 'pending' | 'rejected' | 'published' | 'stale'

/** One draft with what is derived about it now. */
export interface Draft extends Omit<DraftEntry, 'entry'> {
  form: string
  draft: number
  state: DraftState
  /** When a rejection names it: who rejected it, and whether that was its submitter taking it back. A published draft can carry one, written while its approval wrote the version. */
  rejection?: { by: string; withdrawn: boolean }
  /** The form's newest version now, or `null` before its first. */
  current: number | null
}

/**
 * A form's drafts cannot be read: an entry that does not parse or does not
 * validate -- edited by hand, or damaged. Its message names the form and
 * the entry, for the operator's log; never the caller's answer.
 */
export class UnreadableDraftError extends Error {
  override name = 'UnreadableDraftError'
  readonly form: string
  readonly entry: number
  readonly problems: string[]

  constructor(form: string, entry: number, problems: string[]) {
    super(`entry ${String(entry)} of ${form}'s drafts does not validate: ${problems.join('; ')}`)
    this.form = form
    this.entry = entry
    this.problems = problems
  }
}

export interface Drafts {
  /** Appends a draft and gives its number: one that loses the compare-and-swap takes the next. */
  submit(form: string, draft: Omit<DraftEntry, 'entry'>): Promise<number>
  /** Appends the rejection of `draft` by `by`. */
  reject(form: string, draft: number, by: string): Promise<void>
  /** Every draft of `form`, with its state now; throws `UnreadableDraftError` when any of its entries does not read. */
  of(form: string): Promise<Draft[]>
  /** Every form with an entry, in codepoint order. */
  forms(): Promise<string[]>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 1
const isName = (value: unknown): value is string => typeof value === 'string' && value !== ''

type Read = { ok: true; entry: DraftEntry | RejectionEntry } | { ok: false; problems: string[] }

/**
 * Entry `number` of `form` as stored, or why it is not one: a draft whose
 * bundle validates (0019) in format 2 for this form, over a base that is
 * a version number or none, by a named submitter, with confirmations of
 * the shape a publish takes; or the rejection, by somebody, of a draft
 * entered before it. What the bundle is checked against at the write --
 * the allowlist, this server's generator, the database -- an approval asks
 * again, so a later release cannot make a stored draft unreadable.
 */
function entryOf(document: unknown, form: string, number: number, before: ReadonlyMap<number, DraftEntry | RejectionEntry>): Read {
  if (!isRecord(document)) return { ok: false, problems: ['an entry is an object'] }
  if (document['entry'] === 'rejection') {
    const draft = document['draft']
    if (!isNumber(draft) || before.get(draft)?.entry !== 'draft') return { ok: false, problems: ['a rejection names a draft entered before it'] }
    if (!isName(document['by'])) return { ok: false, problems: ['a rejection names who rejected it'] }
    return { ok: true, entry: { entry: 'rejection', draft, by: document['by'] } }
  }
  if (document['entry'] !== 'draft') return { ok: false, problems: ['an entry is a draft or a rejection'] }
  const problems: string[] = []
  const base = document['expectedBase']
  if (base !== null && !isNumber(base)) problems.push('expectedBase is a version or null')
  if (!isName(document['submittedBy'])) problems.push('submittedBy names who submitted it')
  const confirmed = Array.isArray(document['keysConfirmed']) ? readKeysConfirmed(document['keysConfirmed']) : undefined
  if (confirmed === undefined) problems.push('keysConfirmed lists { field, was, now }')
  const checked = validateBundle(document['bundle'])
  if (!checked.ok) problems.push(...checked.problems.map((problem) => `bundle: ${problem}`))
  else if (checked.bundle.format !== 2 || checked.bundle.form.id !== form) problems.push(`bundle: is not a format-2 bundle of ${form}`)
  if (problems.length > 0 || !checked.ok || checked.bundle.format !== 2 || confirmed === undefined) return { ok: false, problems }
  return {
    ok: true,
    entry: {
      entry: 'draft',
      expectedBase: base as number | null,
      bundle: checked.bundle,
      keysConfirmed: confirmed,
      submittedBy: document['submittedBy'] as string,
    },
  }
}

/** One JSON document's text, without the store's indentation: two documents the store wrote are the same bytes exactly when these are equal. */
const text = (document: unknown) => JSON.stringify(document)

/**
 * The drafts of the deployment whose versions are `versions`, kept in
 * `versions.drafts()`.
 */
export function createDrafts(versions: ConfigurationStore): Drafts {
  const store = versions.drafts()

  /**
   * Appends `entry` to `form`'s, after the newest there is. A conflict is
   * somebody else's entry taking that number, so the next is tried: every
   * conflict is an entry written, and the appends end as the writers do.
   * One that names no newer entry would be a store that cannot say what it
   * holds, and is thrown rather than tried for ever.
   */
  async function append(form: string, entry: DraftEntry | RejectionEntry): Promise<number> {
    let base = await store.latest(form)
    for (;;) {
      const outcome = await store.publish(form, base, entry)
      if (outcome.ok) return outcome.version
      if (outcome.current === base) throw new Error(`the drafts store refused entry ${String((base ?? 0) + 1)} of ${form} and names no newer one`)
      base = outcome.current
    }
  }

  /** Every entry of `form`, ascending, each validated: one that is not stops the reading. */
  async function entries(form: string): Promise<Map<number, DraftEntry | RejectionEntry>> {
    const read = new Map<number, DraftEntry | RejectionEntry>()
    for (const number of await store.versions(form)) {
      let document: unknown
      try {
        document = await store.read(form, number)
      } catch (error) {
        if (error instanceof UnparsableVersionError) throw new UnreadableDraftError(form, number, ['the entry is not valid JSON'])
        throw error
      }
      const checked = entryOf(document, form, number, read)
      if (!checked.ok) throw new UnreadableDraftError(form, number, checked.problems)
      read.set(number, checked.entry)
    }
    return read
  }

  /** Whether version `version` of `form` is `bundle`, as the store writes both. A version that does not parse is not served, and is no draft's. */
  async function isPublished(form: string, version: number, bundle: BundleV2): Promise<boolean> {
    try {
      const document = await versions.read(form, version)
      return document !== undefined && text(document) === text(bundle)
    } catch (error) {
      if (error instanceof UnparsableVersionError) return false
      throw error
    }
  }

  return {
    submit: (form, draft) => append(form, { entry: 'draft', ...draft }),

    async reject(form, draft, by) {
      await append(form, { entry: 'rejection', draft, by })
    },

    async of(form) {
      const read = await entries(form)
      const current = await versions.latest(form)
      // The first rejection of a draft decides: a second can only be one written in the same moment.
      const rejections = new Map<number, RejectionEntry>()
      for (const entry of read.values()) if (entry.entry === 'rejection' && !rejections.has(entry.draft)) rejections.set(entry.draft, entry)
      const drafts: Draft[] = []
      for (const [number, entry] of read) {
        if (entry.entry !== 'draft') continue
        const { entry: _entry, ...held } = entry
        const rejected = rejections.get(number)
        const draft: Draft = { form, draft: number, ...held, current, state: 'pending' }
        const next = (entry.expectedBase ?? 0) + 1
        if (rejected !== undefined) draft.rejection = { by: rejected.by, withdrawn: rejected.by === entry.submittedBy }
        // A version served is a fact, asked first: a rejection written while its approval wrote the version decides nothing.
        if (current !== null && current >= next && (await isPublished(form, next, entry.bundle))) {
          draft.state = 'published'
        } else if (rejected !== undefined) {
          draft.state = 'rejected'
        } else if (current !== entry.expectedBase) {
          draft.state = 'stale'
        }
        drafts.push(draft)
      }
      return drafts
    },

    forms: () => store.list(),
  }
}
