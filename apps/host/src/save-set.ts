import { fieldProblems, isUnknownWrite } from '@formancy/data-client'
import type {
  DataClient,
  FormRecord,
  PublishedForm,
  SaveBody,
  SaveChange,
  SaveOutcome,
  SavePart,
  SaveRecordChange,
  SaveRefused,
  TogetherChild,
} from '@formancy/data-client'
import type { ChildForm } from './children.js'
import { listed } from './grid-datasource.js'
import { boundSaid, changesSaid, countsOf, markOf, mayOf } from './rows-said.js'
import { createSession, NEWER } from './session.js'
import type { SaveResult, Session } from './session.js'
import { withoutField } from './widgets.js'
import type { RowsHeld, WithRows } from './with-rows.js'

/*
 * The rows of a record's together children (0155), as the page holds them
 * until the record's own Save: framework-neutral, beside session.ts, so the
 * tab that draws them (together.tsx) and the record's sessions read one
 * set of decisions.
 *
 * - **Listed, then held.** A child's rows are listed once, every one up to
 *   `max + 1`, and held on the page: a new row, with a ref minted from a
 *   counter that never goes back, so a removed row's ref is never used
 *   again (formancy.ai 0041); a row changed, whose draft is its forms', one
 *   per renderer, each typed into copied into the other; a row to be
 *   deleted. Nothing is sent until the record's Save.
 * - **One save.** The record's session asks whether its save carries rows
 *   (`carries`) -- a change, or a new record a child requires rows of --
 *   and takes them (`take`): each new or changed row's forms submitted
 *   first, and a row whose form refuses is opened and nothing is sent. Its
 *   answer is applied to the rows as they were taken (`settle`): each row
 *   takes its stored self where nothing was typed into it since, the
 *   stored version where something was, which keeps its mark; a refusal
 *   about a row goes onto its forms and opens it, one about a child as a
 *   whole onto its tab's line.
 * - **In flight.** Every row stays editable, but a row whose change is in
 *   the save still out is removed, or put back, once it is answered
 *   (`sending`): a new row taken off the page meanwhile would be stored all
 *   the same, and shown nowhere. The set is the record's, every pane's, so
 *   one pane's save of it out, or lost where it created the record, holds a
 *   press in any pane (`held`), and a record it created takes every row
 *   held for it -- one added while it was out too.
 * - **Stale.** Keep my line changes lists the rows again and keeps every
 *   change at the version it was read at, marking a row moved or gone
 *   since; the next save is guarded row by row, and Load this line takes
 *   one row as stored -- or, gone, takes it off the page and says so.
 *
 * What a change is said as -- in the grid, on the tab's line, in the guard
 * and after a save -- is derived here from the rows, never typed per state.
 */

/** A child form whose rows are saved with their record: the menu's child carries its bounds and what this person may do with them (0155). */
export type TogetherForm = ChildForm & { child: ChildForm['child'] & { together: TogetherChild } }

export function isTogether(form: ChildForm): form is TogetherForm {
  return form.child.together !== undefined
}

/** What a new row's key in the grid starts with: no record token does. */
const NEW = '~'

/** The grid's column of each row's change, in words: `~` is in no field key. */
export const CHANGE_COLUMN = '~change'

/** One row of a together child as the page holds it. */
export interface HeldRow {
  /** The grid's: the record's token, or `~` and the ref of a new row. */
  key: string
  /** What its forms' element ids are minted from: a number the page gives each row it holds, since a token's `:` is an engine's id separator. */
  slot: number
  /** A new row's ref, which the save answers it by; null once stored. */
  ref: string | null
  /** As listed, or as the last save stored it; null for a new row. */
  stored: FormRecord | null
  /** The version a change sends: the one the row was read at, kept by Keep my line changes. */
  version: string | null
  /** Its forms, one per renderer, made the first time it is opened or taken. */
  drafts: Session[] | null
  removed: boolean
  /** Moved or gone since its change was read: what Keep my line changes found. */
  moved: 'moved' | 'gone' | null
}

/** Where a child's rows are on the page: not asked yet, being listed, held, or refused in the server's words. */
export type Listing = { kind: 'idle' } | { kind: 'asking' } | { kind: 'listed' } | { kind: 'refused'; message: string }

/** What Load this line came to: the row as stored, the row gone -- deleted since -- and off the page, or the server's sentence. */
export type LineLoaded = { kind: 'loaded' } | { kind: 'gone' } | { kind: 'refused'; message: string }

/** Where the tab is to put the keyboard next, asked once each time `n` moves: its heading, or a row's forms. */
export interface FocusAsk {
  n: number
  to: 'heading' | 'row'
}

/** One together child's rows under the record. */
export interface ChildRows {
  key: string
  form: TogetherForm
  owner: string
  /** The record they are the rows of: its token, or `new`. */
  parent: string
  listing: Listing
  /** Listed in the key's order, new rows last in the order added. */
  rows: HeldRow[]
  /** The row on the rail, by its key. */
  open: string | null
  /** The last ref minted for a new row of these: never taken back, so no two rows of the record's child share one, nor a name. */
  minted: number
  /** What the tab's line adds after a refusal about the child as a whole, or a row. */
  note: string | null
  focus: FocusAsk | null
}

/** The rows' changes one save takes, as they were when Save was pressed. */
export interface TakenRows {
  body: SaveBody['rows']
  sent: Array<{ child: string; changes: Array<{ row: string; kind: 'create' | 'update' | 'delete'; answers: Record<string, unknown> | null }> }>
}

/** Whether two answers are the same value: answers are JSON, so their JSON is. */
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

/** A row's answers without the field that names its record: the save supplies it, so no form of the row holds it. */
function withoutParent(answers: Readonly<Record<string, unknown>>, field: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(answers).filter(([key]) => key !== field))
}

/** Every answer of the form typed into copied into the other, where it differs: one draft, drawn by each renderer. */
function mirror(sessions: readonly Session[]): void {
  let copying = false
  const engines = sessions.map((session) => session.opened().engine)
  for (const from of engines) {
    from.subscribe(() => {
      if (copying) return
      copying = true
      try {
        const want = from.value() as Record<string, unknown>
        for (const to of engines) {
          if (to === from) continue
          const have = to.value() as Record<string, unknown>
          for (const [key, value] of Object.entries(want)) {
            // A field a rule computes is the rule's: the other form computes it too.
            if (!same(value, have[key])) {
              try {
                to.setValue([key], value)
              } catch {
                // Not settable there: the rule's own, as here.
              }
            }
          }
        }
      } finally {
        copying = false
      }
    })
  }
}

export interface SaveSetOptions {
  client: DataClient
  formId: string
  parentNoun: string
  /** The record's together children, as the menu names them now. */
  forms: () => readonly TogetherForm[]
}

export function createSaveSet({ client, formId, parentNoun, forms }: SaveSetOptions) {
  const children = new Map<string, ChildRows>()
  const listeners = new Set<() => void>()
  /** The last row's slot: each row held gets its own. */
  let slots = 0
  let changes = 0
  /** The rows whose change is in a save still out: removed, or put back, once it is answered. */
  const out = new Set<HeldRow>()
  /** What holds each record's rows, by the record's token or `new`: the pane whose save of them was sent last. */
  const holders = new Map<string, () => RowsHeld>()
  const notify = (): void => {
    changes += 1
    for (const listener of listeners) listener()
  }
  const keyOf = (form: TogetherForm): string => `${form.child.form}~${form.child.field}`
  const rowIn = (child: ChildRows, key: string): HeldRow | undefined => child.rows.find((row) => row.key === key)
  const ask = (child: ChildRows, to: FocusAsk['to']): void => {
    child.focus = { n: (child.focus?.n ?? 0) + 1, to }
  }

  /** The child's definition as a save offers it: the field naming the record left out, and the writes this person may make there. */
  function inSave(child: ChildRows): PublishedForm {
    const { definition, child: menu } = child.form
    const may = mayOf(child)
    return {
      ...definition,
      form: withoutField(definition.form, menu.field),
      operations: ['read', ...(may.create ? (['create'] as const) : []), ...(may.update ? (['update'] as const) : [])],
    }
  }

  /** A row's forms, made the first time they are asked for: over the row as stored, or new. */
  function drafted(child: ChildRows, row: HeldRow): Session[] {
    if (row.drafts !== null) return row.drafts
    const definition = inSave(child)
    const sessions = (['react', 'angular'] as const).map((renderer) =>
      createSession({ client, formId: child.form.child.form, definition, renderer, namespace: `${child.owner}~${String(row.slot)}` }),
    )
    for (const session of sessions) {
      if (row.stored === null) session.start({})
      else session.open({ ...row.stored, answers: withoutParent(row.stored.answers, child.form.child.field) as FormRecord['answers'] })
    }
    mirror(sessions)
    // The row's mark and the tab's line follow its first keystroke, and its last one back to what it was: not every keystroke.
    const [first] = sessions as [Session]
    let was = first.changed()
    first.opened().engine.subscribe(() => {
      const now = first.changed()
      if (now === was || row.drafts !== sessions) return
      was = now
      notify()
    })
    row.drafts = sessions
    return sessions
  }

  /** What a row's change sends: every answer the write takes from this person (0117), never the field naming the record. */
  function answersOf(child: ChildRows, session: Session, kind: 'create' | 'update'): Record<string, unknown> {
    const accepted = child.form.definition.writable[kind]
    const value = (session.opened().engine.value() ?? {}) as Record<string, unknown>
    return Object.fromEntries(Object.entries(value).filter(([key]) => key !== child.form.child.field && (accepted === null || accepted.includes(key))))
  }

  /** The children whose rows are the record's now. */
  const under = (record: string | undefined): ChildRows[] => [...children.values()].filter((child) => child.parent === (record ?? 'new'))

  async function list(child: ChildRows, keep = false): Promise<void> {
    if (child.parent === 'new') {
      child.listing = { kind: 'listed' }
      notify()
      return
    }
    const parent = child.parent
    child.listing = { kind: 'asking' }
    notify()
    const { field, together } = child.form.child
    const page = await client.list(child.form.child.form, { parent: { field, record: parent }, limit: together.max + 1 })
    // Another record since: its rows are not these.
    if (child.parent !== parent) return
    if (!page.ok) {
      child.listing = { kind: 'refused', message: page.message }
      notify()
      return
    }
    const fresh = (record: FormRecord): HeldRow => ({
      slot: (slots += 1),
      key: record.record ?? '',
      ref: null,
      stored: record,
      version: record.version,
      drafts: null,
      removed: false,
      moved: null,
    })
    const held = new Map(child.rows.filter((row) => row.ref === null).map((row) => [row.key, row]))
    const pending = (row: HeldRow | undefined): row is HeldRow => row !== undefined && (row.removed || row.drafts?.[0]?.changed() === true)
    const rows = page.value.rows
      .filter((record) => record.record !== null)
      .map((record) => {
        const was = held.get(record.record ?? '')
        if (!keep || !pending(was)) return fresh(record)
        // A change kept at the version it was read at; the row moved under it is said, and refused row by row at the next save.
        was.moved = record.version === was.version ? null : 'moved'
        return was
      })
    const gone = keep ? [...held.values()].filter((row) => pending(row) && !rows.includes(row)) : []
    for (const row of gone) row.moved = 'gone'
    child.rows = [...rows, ...gone, ...child.rows.filter((row) => row.ref !== null)]
    child.listing = { kind: 'listed' }
    notify()
  }

  const set = {
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    /** How many times the rows have changed: what a tab reads, so it draws again. */
    version: (): number => changes,
    /**
     * The child's rows under `parent`, the record's token or `new`, made
     * where there are none -- or where the ones held are another record's,
     * which a request that replaced the record has already asked about.
     */
    child(form: TogetherForm, owner: string, parent: string): ChildRows {
      const key = keyOf(form)
      const held = children.get(key)
      if (held !== undefined && held.parent === parent) {
        held.form = form
        return held
      }
      const made: ChildRows = { key, form, owner, parent, listing: { kind: 'idle' }, rows: [], open: null, minted: 0, note: null, focus: null }
      children.set(key, made)
      return made
    },
    list: (child: ChildRows): Promise<void> => list(child),
    /** A new row, last, open on the rail. */
    add(child: ChildRows): HeldRow {
      child.minted += 1
      const ref = `r${String(child.minted)}`
      const row: HeldRow = { key: `${NEW}${ref}`, slot: (slots += 1), ref, stored: null, version: null, drafts: null, removed: false, moved: null }
      child.rows.push(row)
      drafted(child, row)
      child.open = row.key
      child.note = null
      notify()
      return row
    },
    /** A row's forms, for the rail. */
    drafts: (child: ChildRows, row: HeldRow): Session[] => drafted(child, row),
    open(child: ChildRows, key: string | null): void {
      child.open = key
      notify()
    },
    /**
     * Remove, and Undo remove: a stored row marked to be deleted, or no
     * longer; a new row taken off the page, which this answers true for.
     * Nothing for a row whose change is in the save still out (`sending`).
     */
    remove(child: ChildRows, key: string, removed: boolean): boolean {
      const row = rowIn(child, key)
      if (row === undefined || out.has(row)) return false
      const taken = row.ref !== null
      if (taken) {
        child.rows = child.rows.filter((each) => each !== row)
        if (child.open === key) child.open = null
      } else row.removed = removed
      notify()
      return taken
    },
    /** Whether a row's change is in the save still out: it is removed, or put back, once that is answered. */
    sending: (row: HeldRow): boolean => out.has(row),
    /**
     * Load this line: the row as stored now, its draft dropped -- or, gone
     * since, off the page, which the tab's line says.
     */
    async loadLine(child: ChildRows, key: string): Promise<LineLoaded> {
      const row = rowIn(child, key)
      if (row === undefined) return { kind: 'loaded' }
      const read = await client.read(child.form.child.form, key)
      if (!read.ok && !(read.status === 404 && read.code === 'not-found')) return { kind: 'refused', message: read.message }
      // What the tab said of it -- refused, changed by someone else -- is said no longer.
      child.note = null
      if (read.ok) Object.assign(row, { stored: read.value, version: read.value.version, drafts: null, removed: false, moved: null })
      else {
        child.rows = child.rows.filter((each) => each !== row)
        child.open = null
        child.note = `${child.form.menu.title} ${key} was deleted by someone else: your change to it was discarded.`
      }
      notify()
      return read.ok ? { kind: 'loaded' } : { kind: 'gone' }
    },
    /** The rows as the grid shows them: each as typed, with its change in words. */
    gridRows(child: ChildRows): FormRecord[] {
      return child.rows.map((row) => {
        const answers = row.drafts?.[0]?.opened().engine.value() ?? row.stored?.answers ?? {}
        return { record: row.key, version: row.version, answers: { ...(answers as FormRecord['answers']), [CHANGE_COLUMN]: markOf(row) } }
      })
    },
    /** Whether a child's rows hold a change the record's save would carry. */
    pending: (child: ChildRows): boolean => {
      const { added, changed, deleted } = countsOf(child)
      return added + changed + deleted > 0
    },
    /** Discard and continue: every change of the child's rows dropped, the rows as listed. */
    discard(child: ChildRows): void {
      child.rows = child.rows.filter((row) => row.ref === null).map((row) => ({ ...row, drafts: null, removed: false, moved: null }))
      child.open = null
      child.note = null
      notify()
    },
    /** A focus asked for, once acted on. */
    focused(child: ChildRows): void {
      child.focus = null
    },
  }

  const withRows: WithRows = {
    carries(record) {
      if (under(record).some((child) => set.pending(child))) return true
      // A new record a together child requires rows of goes as one save, its bound said by the server where none were added.
      return record === undefined && forms().some((form) => form.child.together.min >= 1 && form.child.together.created.create)
    },
    held: (record) => holders.get(record ?? 'new')?.() ?? null,
    holding(record, holds) {
      holders.set(record ?? 'new', holds)
    },
    owners: (record) => under(record).map((child) => child.owner),
    created(record) {
      // Every row held for a new record is the created one's, whether or not its save carried them: a row added while it was out,
      // or a child it took none of, is saved with it next.
      for (const child of under(undefined)) child.parent = record
      notify()
    },
    take(record) {
      const taken: TakenRows = { body: [], sent: [] }
      let refused: ChildRows | null = null
      for (const child of under(record)) {
        const changesOf: SaveChange[] = []
        const sent: TakenRows['sent'][number]['changes'] = []
        for (const row of child.rows) {
          if (row.removed) {
            if (row.stored !== null && row.version !== null) {
              changesOf.push({ delete: { record: row.key, version: row.version } })
              sent.push({ row: row.key, kind: 'delete', answers: null })
            }
            continue
          }
          const changed = row.ref !== null || row.drafts?.[0]?.changed() === true
          if (!changed) continue
          const drafts = drafted(child, row)
          const accepted = drafts.map((session) => session.opened().engine.submit().ok)
          if (accepted.some((ok) => !ok)) {
            if (refused === null) {
              refused = child
              child.open = row.key
              ask(child, 'row')
            }
            continue
          }
          const [first] = drafts as [Session]
          if (row.ref !== null) {
            const answers = answersOf(child, first, 'create')
            changesOf.push({ create: { ref: row.ref, answers } })
            sent.push({ row: row.key, kind: 'create', answers })
          } else {
            const answers = answersOf(child, first, 'update')
            changesOf.push({ update: { record: row.key, version: row.version ?? '', answers } })
            sent.push({ row: row.key, kind: 'update', answers })
          }
        }
        child.note = null
        if (changesOf.length === 0) continue
        taken.body.push({ form: child.form.child.form, field: child.form.child.field, changes: changesOf })
        taken.sent.push({ child: child.key, changes: sent })
      }
      notify()
      return refused === null ? taken : null
    },
    async send(record: SaveRecordChange, taken: TakenRows): Promise<SaveOutcome> {
      const sent = taken.sent.flatMap(({ child: key, changes: each }) => {
        const child = children.get(key)
        return child === undefined ? [] : each.flatMap((change) => rowIn(child, change.row) ?? [])
      })
      for (const row of sent) out.add(row)
      notify()
      try {
        return await client.save(formId, { record, rows: taken.body })
      } finally {
        for (const row of sent) out.delete(row)
        notify()
      }
    },
    settle(outcome: SaveOutcome, taken: TakenRows, result: SaveResult): SaveResult {
      if (outcome.ok) return stored(outcome.value, taken, result)
      if (isUnknownWrite(outcome)) return result
      const refusal = refused(outcome)
      notify()
      return refusal === null ? result : { kind: 'rows', message: refusal }
    },
    reload(record) {
      for (const child of [...children.values()].filter((each) => each.parent === (record ?? 'new'))) {
        child.rows = []
        child.open = null
        child.note = null
        void list(child)
      }
    },
    async keep(record) {
      await Promise.all(under(record).map((child) => list(child, true)))
    },
  }

  /** What a save stored, applied to the rows as they were taken; and the record's result said with them. */
  function stored(saved: Extract<SaveOutcome, { ok: true }>['value'], taken: TakenRows, result: SaveResult): SaveResult {
    const record = saved.record.record ?? 'new'
    const said: string[] = []
    let newer = result.message.endsWith(NEWER)
    for (const { child: key, changes: sent } of taken.sent) {
      const child = children.get(key)
      if (child === undefined) continue
      const answered = saved.rows.find((each) => each.form === child.form.child.form && each.field === child.form.child.field)?.changes ?? []
      const counts = { held: 0, added: 0, changed: 0, deleted: 0 }
      sent.forEach((change, index) => {
        const answer = answered[index]
        const row = rowIn(child, change.row)
        counts[change.kind === 'create' ? 'added' : change.kind === 'update' ? 'changed' : 'deleted'] += 1
        if (row === undefined || answer === undefined) return
        if ('deleted' in answer) {
          child.rows = child.rows.filter((each) => each !== row)
          if (child.open === row.key) child.open = null
          return
        }
        const was = row.key
        const now = (row.drafts?.[0]?.opened().engine.value() ?? {}) as Record<string, unknown>
        const typed = Object.entries(change.answers ?? {}).some(([field, value]) => !same(now[field], value))
        row.stored = answer.row
        row.version = answer.row.version
        row.key = answer.row.record ?? row.key
        row.ref = null
        if (child.open === was) child.open = row.key
        if (typed) {
          // Typed into while the save was out: the newer answers stay, and so does the mark.
          newer = true
          return
        }
        row.drafts = null
      })
      child.parent = record
      const words = changesSaid(child.form.menu.title, counts, 'deleted')
      if (words !== null) said.push(words)
    }

    const tail = newer ? ` ${NEWER}` : ''
    const rows = said.length === 0 ? '' : listed(said)
    notify()
    if (result.kind === 'created') {
      const made = saved.record.record === null ? 'Created' : `Created record ${saved.record.record}`
      return { kind: 'created', message: `${made}${rows === '' ? '' : ` with ${rows.replace(/ added/g, '')}`}.${tail}` }
    }
    return result.kind === 'saved' ? { kind: 'saved', message: `Saved the ${parentNoun}${rows === '' ? '' : `: ${rows}`}.${tail}` } : result
  }

  /**
   * A save's refusal about the rows, put where it is about: a row's field
   * errors onto its forms, a stale row marked moved and one not found gone,
   * anything else about a child onto its tab's line; and the first of them
   * opened, its tab taking the keyboard -- unless the record has field
   * errors of its own, which its pane's summary takes the keyboard for. The
   * words the record's pane says for it, or null where the refusal is the
   * record's.
   */
  function refused(outcome: SaveRefused): string | null {
    const isRecord = (part: SavePart): boolean => 'record' in part && part.record === true
    const childAt = (part: SavePart): ChildRows | undefined =>
      'form' in part ? [...children.values()].find((child) => child.form.child.form === part.form && child.form.child.field === part.field) : undefined
    const rowAt = (child: ChildRows, part: SavePart): HeldRow | undefined =>
      'ref' in part
        ? child.rows.find((row) => row.ref === part.ref)
        : 'record' in part && typeof part.record === 'string'
          ? rowIn(child, part.record)
          : undefined
    if (outcome.rows !== undefined) {
      const child = childAt(outcome.rows)
      if (child === undefined) return null
      child.note = boundSaid(parentNoun, child.form.menu.title, outcome.rows)
      ask(child, 'heading')
      return child.note
    }
    const placed: Array<{ child: ChildRows; row: HeldRow | undefined; fields: boolean }> = []
    const place = (part: SavePart, fields: Record<string, string[]>): void => {
      const child = childAt(part)
      if (child === undefined) return
      const row = rowAt(child, part)
      const known = Object.keys(fields).length > 0
      if (row !== undefined && known) for (const session of drafted(child, row)) session.opened().engine.applyServerErrors(fields)
      // Stale, it moved since it was read; not found, it is gone -- a row the page listed under its record is under no other:
      // either way, changed by someone else, which Load this line takes as stored, or off the page.
      if (row !== undefined && row.ref === null && (outcome.code === 'stale' || outcome.code === 'not-found'))
        row.moved = outcome.code === 'stale' ? 'moved' : 'gone'
      if (row === undefined || !known) child.note = outcome.message
      placed.push({ child, row, fields: known })
    }
    for (const part of outcome.parts ?? []) if (!isRecord(part.at)) place(part.at, fieldProblems({ ...outcome, fieldErrors: part.fieldErrors }))
    if (outcome.at !== undefined && !isRecord(outcome.at)) place(outcome.at, fieldProblems(outcome))
    const [first] = placed
    if (first === undefined) return null
    if ((outcome.parts ?? []).some((part) => isRecord(part.at))) return null
    if (first.row !== undefined) first.child.open = first.row.key
    ask(first.child, first.row !== undefined && first.fields ? 'row' : 'heading')
    return outcome.message
  }

  return { ...set, rows: withRows }
}

export type SaveSet = ReturnType<typeof createSaveSet>
