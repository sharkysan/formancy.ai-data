import type { FormBindings } from '../generate/types.js'
import type { CoverageGap, InboundKey, MetadataSnapshot, ObjectRef, ReferentialAction } from '../metadata.js'
import type { DeleteReach } from '../records/types.js'
import type { Deleting } from '../runtime.js'
import { findObject, gapCovers } from '../snapshot.js'
import type { CascadeRule, DeleteAction, FormPolicy } from './types.js'

/*
 * What deleting a record of a form's root also does, through the foreign
 * keys that refer to it and to every table a delete of it reaches, and
 * whether the policy may grant it (0050, 0051).
 *
 * One decision, asked at publish and on every read of a bundle
 * (`policyProblems`), by the planner before a delete is sent, by drift review
 * through `unaccepted`, and by the studio: so a delete the policy cannot
 * grant is refused alike everywhere, and a key that would act on a delete
 * stops it in review exactly where it would be refused at publish.
 *
 * A delete reaches another table's rows only through a key the policy's
 * `cascades` names with what it does (0051): every key that cascades, sets
 * NULL or sets a default onto a table the delete removes rows of is
 * followed, a cascade into its table and on from there; one that only
 * refuses -- NO ACTION, RESTRICT -- is the database's to enforce, which a
 * person is told may happen. Triggers and rules are not keys: what the
 * database runs on a delete beyond them is its own (0050).
 */

/** What an acting key does to the rows that refer to the record deleted, for a sentence. */
const ACTIONS: Readonly<Partial<Record<ReferentialAction, string>>> = {
  cascade: 'ON DELETE CASCADE',
  'set-null': 'ON DELETE SET NULL',
  'set-default': 'ON DELETE SET DEFAULT',
}

const SPELLED: Readonly<Record<ReferentialAction, string>> = {
  'no-action': 'NO ACTION',
  restrict: 'RESTRICT',
  cascade: 'CASCADE',
  'set-null': 'SET NULL',
  'set-default': 'SET DEFAULT',
}

/** Whether a key changes other rows when a row it refers to is deleted: cascades, or sets NULL or a default. */
export function actsOnDelete(action: ReferentialAction): action is DeleteAction {
  return ACTIONS[action] !== undefined
}

/** The keys a stored policy accepts, whatever shape a hand edit left it in; `validatePolicy` reports a bad shape, and an entry it would refuse accepts nothing. */
function acceptances(policy: Pick<FormPolicy, 'cascades'>): Array<{ rule: CascadeRule; index: number }> {
  const cascades: unknown = (policy as { cascades?: unknown }).cascades
  if (!Array.isArray(cascades)) return []
  const isName = (value: unknown): value is string => typeof value === 'string' && value !== ''
  return (cascades as unknown[]).flatMap((entry, index) => {
    if (typeof entry !== 'object' || entry === null) return []
    const { table, foreignKey, onDelete } = entry as Record<string, unknown>
    if (typeof table !== 'object' || table === null) return []
    const { schema, name } = table as Record<string, unknown>
    if (!isName(schema) || !isName(name) || !isName(foreignKey) || typeof onDelete !== 'string' || !actsOnDelete(onDelete as ReferentialAction)) return []
    return [{ rule: { table: { schema, name }, foreignKey, onDelete: onDelete as DeleteAction }, index }]
  })
}

function sameRef(left: ObjectRef, right: ObjectRef): boolean {
  return left.schema === right.schema && left.name === right.name
}

function names(rule: CascadeRule, key: Pick<InboundKey, 'table' | 'name'>): boolean {
  return sameRef(rule.table, key.table) && rule.foreignKey === key.name
}

/**
 * Whether a key onto a table a delete reaches does something on delete the
 * policy has not accepted: it acts, and `cascades` does not name it with
 * that action. Counted whatever its `enforced` flag: on PostgreSQL a key
 * some of whose triggers are disabled may still act (0049), and one enabled
 * again acts without anything here noticing.
 *
 * Drift review asks this of a key that appeared or changed, so a change it
 * calls unaccepted is one the publish check would refuse.
 */
export function unaccepted(policy: Pick<FormPolicy, 'cascades'>, key: Pick<InboundKey, 'table' | 'name' | 'onDelete'>): boolean {
  return actsOnDelete(key.onDelete) && !acceptances(policy).some(({ rule }) => names(rule, key) && rule.onDelete === key.onDelete)
}

/** The roles a stored policy grants delete, whatever shape a hand edit left it in; `validatePolicy` reports a bad shape. */
function deleteRoles(policy: Pick<FormPolicy, 'operations'>): string[] {
  const operations: unknown = (policy as { operations?: unknown }).operations
  const roles: unknown = typeof operations === 'object' && operations !== null && Object.hasOwn(operations, 'delete') ? (operations as Record<string, unknown>)['delete'] : undefined
  return Array.isArray(roles) ? roles.filter((role): role is string => typeof role === 'string' && role !== '') : []
}

/** Whether a stored policy lets any role delete. */
export function grantsDelete(policy: Pick<FormPolicy, 'operations'>): boolean {
  return deleteRoles(policy).length > 0
}

/** A key onto a table a delete reaches, with that table. */
interface Reached {
  key: InboundKey
  onto: ObjectRef
}

/** A table the walk could not look past, and the key that reached it. */
interface Unseen {
  table: ObjectRef
  via: InboundKey
  how: 'removed' | 'cleared'
  why: 'outside' | 'unrecorded'
}

/**
 * Every key a delete of one record of `root` acts through, as the snapshot
 * shows it, and everything the walk could not see. Policy-free: what the
 * database does, which the policy is then held to.
 */
interface Walk {
  /** The root first, then in the order the walk reached them. */
  removed: ObjectRef[]
  /** Each table whose referencing columns a delete sets NULL or to a default, with every such column. */
  cleared: Array<{ table: ObjectRef; columns: string[] }>
  /** Every key that acts on delete onto a table the delete removes rows of. */
  acting: Reached[]
  /**
   * Every key that only refuses: NO ACTION or RESTRICT on delete onto a
   * removed table (`on: 'delete'`), or on update onto a cleared column
   * (`on: 'update'`) -- whose ON DELETE never runs, since a delete keeps the
   * rows it clears.
   */
  restricting: Array<Reached & { on: 'delete' | 'update' }>
  /** Every key that carries a cleared column's change on, by ON UPDATE CASCADE, SET NULL or SET DEFAULT. */
  following: Array<Reached & { cleared: InboundKey; columns: string[] }>
  unseen: Unseen[]
  /** Each `referenced-by` gap, once, with the first table of the reach it covers. */
  hidden: Array<{ table: ObjectRef; gap: CoverageGap }>
  /** Each table past the root the snapshot says the account may not DELETE from. */
  undeletable: ObjectRef[]
}

function walk(snapshot: MetadataSnapshot, root: ObjectRef): Walk {
  const found: Walk = { removed: [{ schema: root.schema, name: root.name }], cleared: [], acting: [], restricting: [], following: [], unseen: [], hidden: [], undeletable: [] }
  const reported = new Set<CoverageGap>()
  /** The table's keys, or nothing when the snapshot cannot say them; records why, and any gap over them. */
  const keysOf = (table: ObjectRef, via: InboundKey | null, how: Unseen['how']): readonly InboundKey[] => {
    const object = findObject(snapshot, table)
    if (object === undefined || object.referencedBy === undefined) {
      if (via !== null && !found.unseen.some((known) => sameRef(known.table, table))) found.unseen.push({ table, via, how, why: object === undefined ? 'outside' : 'unrecorded' })
      return []
    }
    for (const gap of snapshot.gaps) {
      if (gap.aspect === 'referenced-by' && gapCovers(gap, table) && !reported.has(gap)) {
        reported.add(gap)
        found.hidden.push({ table, gap })
      }
    }
    if (via !== null && object.access?.delete !== true && !found.undeletable.some((known) => sameRef(known, table))) found.undeletable.push(table)
    return object.referencedBy
  }

  const queue: Array<{ table: ObjectRef; via: InboundKey | null }> = [{ table: root, via: null }]
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    for (const key of keysOf(next.table, next.via, 'removed')) {
      const reached = { key, onto: next.table }
      if (key.onDelete === 'cascade') {
        found.acting.push(reached)
        if (!found.removed.some((table) => sameRef(table, key.table))) {
          found.removed.push({ ...key.table })
          queue.push({ table: key.table, via: key })
        }
      } else if (actsOnDelete(key.onDelete)) {
        found.acting.push(reached)
        const entry = found.cleared.find((candidate) => sameRef(candidate.table, key.table))
        if (entry === undefined) found.cleared.push({ table: { ...key.table }, columns: [...key.columns] })
        else for (const column of key.columns) if (!entry.columns.includes(column)) entry.columns.push(column)
      } else {
        found.restricting.push({ ...reached, on: 'delete' })
      }
    }
  }

  // A cleared row stays, so no key acts on its delete; one that refers to a
  // cleared column acts on its change, by ON UPDATE.
  for (const { table, columns } of found.cleared) {
    const clearing = found.acting.filter(({ key }) => key.onDelete !== 'cascade' && sameRef(key.table, table)).map(({ key }) => key)
    for (const key of keysOf(table, clearing[0] as InboundKey, 'cleared')) {
      const touched = key.referencedColumns.filter((column) => columns.includes(column))
      if (touched.length === 0) continue
      // Named by the key that clears a column it follows, not by the first
      // key that clears anything in the table.
      const cleared = clearing.find((candidate) => candidate.columns.some((column) => touched.includes(column))) as InboundKey
      if (actsOnDelete(key.onUpdate)) found.following.push({ key, onto: table, cleared, columns: touched })
      else found.restricting.push({ key, onto: table, on: 'update' })
    }
  }
  return found
}

const byCodepoint = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0)
const refOrder = (left: ObjectRef, right: ObjectRef): number => byCodepoint(left.schema, right.schema) || byCodepoint(left.name, right.name)

/** What a delete of one record of the form's root reaches, as the snapshot shows it, and whether a key may refuse it. */
export interface DeleteReachFacts {
  reach: DeleteReach
  /** A NO ACTION or RESTRICT key refers to a table the delete reaches, or to a column it clears: the database may refuse it while the record is referred to. */
  restricted: boolean
}

/**
 * What deleting one record of `root` reaches (0051): the tables it removes
 * rows of -- the root first, then the rest in codepoint order of schema and
 * name -- the tables whose references it clears, and each key `policy`
 * accepts, with the table it refers to. `restricted` says whether the
 * snapshot shows a key that would refuse the delete while a row refers to
 * the record, whether or not one does.
 *
 * The reach is the database's: every table an acting key reaches, accepted
 * or not. A delete is planned only where `deleteProblems` finds nothing, and
 * there every key that acts is accepted.
 */
export function deleteReach(snapshot: MetadataSnapshot, root: ObjectRef, policy: Pick<FormPolicy, 'cascades'>): DeleteReachFacts {
  const walked = walk(snapshot, root)
  const [first, ...rest] = walked.removed
  const accepted = walked.acting
    .filter(({ key }) => !unaccepted(policy, key))
    .map(({ key, onto }) => ({ from: { ...key.table }, name: key.name, onto: { ...onto }, onDelete: key.onDelete as DeleteAction }))
    .sort((left, right) => refOrder(left.from, right.from) || byCodepoint(left.name, right.name))
  return {
    reach: {
      removed: [first as ObjectRef, ...rest.sort(refOrder)],
      cleared: walked.cleared.map((entry) => ({ table: entry.table, columns: entry.columns })).sort((left, right) => refOrder(left.table, right.table)),
      accepted,
    },
    restricted: walked.restricting.length > 0,
  }
}

/**
 * What a delete of a record of `root` does besides removing it, for a page
 * to word its confirmation by (0051): whether the policy accepts a key that
 * deletes other rows, or one that sets NULL or a default in them, and
 * whether a key may refuse the delete -- never which tables.
 */
export function deleteEffects(snapshot: MetadataSnapshot, root: ObjectRef, policy: Pick<FormPolicy, 'cascades'>): Deleting {
  const { reach, restricted } = deleteReach(snapshot, root, policy)
  return { cascades: reach.accepted.some((key) => key.onDelete === 'cascade'), clears: reach.accepted.some((key) => key.onDelete !== 'cascade'), restricted }
}

function describe(ref: ObjectRef): string {
  return `${ref.schema}.${ref.name}`
}

/** What one acting key does to the rows that refer to a record of `root` that is deleted, as a clause: drift review says it too. */
export function deleteEffect(root: ObjectRef, key: Pick<InboundKey, 'table' | 'name' | 'columns' | 'onDelete'>): string {
  const of = describe(key.table)
  const action = ACTIONS[key.onDelete] as string
  if (key.onDelete === 'cascade') return `deleting a record of ${describe(root)} also deletes rows of ${of} (${key.name}, ${action})`
  const columns = key.columns.join(', ')
  return `deleting a record of ${describe(root)} also sets ${columns} of ${of} to ${key.onDelete === 'set-null' ? 'NULL' : 'its default'} in the rows that refer to it (${key.name}, ${action})`
}

/** Whether `rule` names a key the delete acts through, with the action that key has. */
function actsThrough(walked: Walk, rule: CascadeRule): boolean {
  return walked.acting.some(({ key }) => names(rule, key) && key.onDelete === rule.onDelete)
}

/**
 * Each `cascades` entry that names no key a delete acts through, or names it
 * with another action than it has. Only a key onto a table the delete
 * removes rows of is matched: one onto a table it only clears is read for
 * its ON UPDATE, and its ON DELETE never runs, so naming it says the delete
 * does what it does not.
 */
function strays(policy: Pick<FormPolicy, 'cascades'>, walked: Walk): Array<{ rule: CascadeRule; index: number }> {
  return acceptances(policy).filter(({ rule }) => !actsThrough(walked, rule))
}

/** Why each stray acceptance says something untrue, as the publish check words it. */
function strayAcceptances(policy: Pick<FormPolicy, 'cascades'>, walked: Walk, root: ObjectRef): string[] {
  const onDelete = [...walked.acting, ...walked.restricting.filter(({ on }) => on === 'delete')]
  const onUpdate = [...walked.restricting.filter(({ on }) => on === 'update'), ...walked.following]
  return strays(policy, walked).flatMap(({ rule, index }) => {
    const at = `cascades[${String(index)}] accepts ${rule.foreignKey} of ${describe(rule.table)}`
    const keys = onDelete.filter(({ key }) => names(rule, key))
    if (keys.length === 0) {
      const kept = onUpdate.find(({ key }) => names(rule, key))
      return [
        kept === undefined
          ? `${at}, and no such key refers to a table a delete of ${describe(root)} reaches`
          : `${at}, and a delete of ${describe(root)} does not act through it: it refers to ${describe(kept.onto)}, whose rows a delete keeps and clears a reference in`,
      ]
    }
    return keys.map(({ key }) => `${at} as ON DELETE ${SPELLED[rule.onDelete]}, and it is ON DELETE ${SPELLED[key.onDelete]}`)
  })
}

/** What every refusal of a grant of delete starts with: what follows is the clause. */
const GRANTED = 'operations.delete grants roles, and'

/** A snapshot taken before 0049, which does not record what refers to the root. */
function unrecorded(root: ObjectRef): string {
  return `this snapshot does not record what refers to ${describe(root)}, so what a delete also does cannot be seen: discover again`
}

/**
 * Why a grant of delete is refused whatever `cascades` names, as clauses
 * that follow `GRANTED`, kind by kind: a `referenced-by` gap over a table of
 * the reach; a table the walk could not look past, outside the scope or
 * unrecorded; a cleared column another key follows ON UPDATE; and a table
 * past the root the account may not DELETE from.
 */
function blockers(walked: Walk, root: ObjectRef): { hidden: string[]; unseen: string[]; following: string[]; undeletable: string[] } {
  const table = describe(root)
  return {
    hidden: walked.hidden.map(({ table: covered, gap }) =>
      sameRef(covered, root)
        ? `this snapshot cannot show everything that refers to ${table}: ${gap.detail}`
        : `this snapshot cannot show everything that refers to ${describe(covered)}, which a delete of ${table} reaches: ${gap.detail}`,
    ),
    unseen: walked.unseen.map(({ table: unseen, how, why }) =>
      why === 'unrecorded'
        ? `this snapshot does not record what refers to ${describe(unseen)}, which a delete of ${table} reaches, so what a delete also does cannot be seen: discover again`
        : how === 'removed'
          ? `deleting a record of ${table} also deletes rows of ${describe(unseen)}, outside the approved schemas, and what that reaches in turn cannot be seen`
          : `deleting a record of ${table} also changes rows of ${describe(unseen)}, outside the approved schemas, and what follows from that change cannot be seen`,
    ),
    following: walked.following.map(
      ({ key, cleared, columns }) =>
        `${deleteEffect(root, cleared)}, and ${key.name} of ${describe(key.table)} follows ${columns.join(', ')} ON UPDATE ${SPELLED[key.onUpdate]}, which a delete does not follow`,
    ),
    undeletable: walked.undeletable.map(
      (undeletable) =>
        `deleting a record of ${table} reaches ${describe(undeletable)}, which this connection's account may not DELETE from: a delete is held to the account's DELETE on every table it reaches`,
    ),
  }
}

/**
 * Why a policy may not grant delete on this form, as the snapshot shows the
 * form's root and every table a delete of it reaches, or nothing (0050,
 * 0051): nothing when it grants delete to nobody. Every problem, because a
 * person fixes a policy from the list.
 *
 * Refused when the snapshot does not record what refers to the root -- one
 * taken before 0049 -- or says by a `referenced-by` gap that it cannot see
 * all of what refers to a table the delete reaches; for every key that acts
 * on delete, enforced or not, that `cascades` does not name with its action;
 * for a table the delete reaches outside the approved schemas, whose keys
 * cannot be seen; for a cleared column another key follows ON UPDATE, which
 * would carry the change past anything `cascades` can name; for a table past
 * the root the account may not DELETE from; and for an acceptance of a key
 * the delete does not act through, or with another action than the key has.
 */
export function deleteProblems(snapshot: MetadataSnapshot, bindings: FormBindings, policy: FormPolicy): string[] {
  if (!grantsDelete(policy)) return []
  const root = findObject(snapshot, bindings.root)
  // A root the snapshot lacks is the bindings' problem, reported as such.
  if (root === undefined) return []
  const granted = (clause: string) => `${GRANTED} ${clause}`
  if (root.referencedBy === undefined) return [granted(unrecorded(root.ref))]
  const walked = walk(snapshot, root.ref)
  const blocked = blockers(walked, root.ref)
  return [
    ...blocked.hidden.map(granted),
    ...walked.acting.filter(({ key }) => unaccepted(policy, key)).map(({ key }) => granted(`${deleteEffect(root.ref, key)}, which cascades does not accept`)),
    ...blocked.unseen.map(granted),
    ...blocked.following.map(granted),
    ...blocked.undeletable.map(granted),
    ...strayAcceptances(policy, walked, root.ref),
  ]
}

/** One key a delete reaches, with the table of the reach it refers to. */
export interface ReachedKey {
  key: InboundKey
  onto: ObjectRef
}

/**
 * What a delete of a record of a form's root acts through, may be refused
 * by, and cannot be granted over, key by key, as the snapshot shows it: what
 * an administrator is asked to accept one key at a time before anybody may
 * delete (0052). The walk is `deleteProblems`', and so are the words.
 */
export interface DeleteReview {
  /**
   * Every key that acts on a delete -- cascades, sets NULL or a default --
   * onto a table the delete removes rows of, past the root too, in the order
   * the walk meets it, each with whether `cascades` names it with its action
   * (`unaccepted`). A grant of delete is refused while one is not.
   */
  acting: Array<ReachedKey & { accepted: boolean }>
  /**
   * Every key that only refuses: NO ACTION or RESTRICT on delete onto a
   * table the delete removes rows of (`on: 'delete'`), or on update onto a
   * column it clears (`on: 'update'`). The database refuses the delete while
   * a row refers through one; nothing is named for it.
   */
  restricting: Array<ReachedKey & { on: 'delete' | 'update' }>
  /** Each `cascades` entry, by its place in the list, that names no key the delete acts through with the action that key has. */
  stray: Array<{ index: number; rule: CascadeRule }>
  /**
   * Why a grant of delete is refused whatever `cascades` names, in
   * `deleteProblems`' words after its "operations.delete grants roles,
   * and": with every key of `acting` named and nothing else, those are its
   * problems, these, in this order.
   */
  blocked: string[]
  /**
   * Whether the keys named here -- in `acting`, `restricting` and `blocked`
   * -- are every key the catalog shows onto the tables the delete removes
   * rows of, and onto the columns it clears: no table of the reach behind a
   * `referenced-by` gap, outside the scope or unrecorded. A key onto another
   * column of a row the delete only clears is not affected, and not named.
   */
  complete: boolean
}

/**
 * The review of a delete of a record of `root` against `policy` (0052),
 * whoever the policy lets delete: the keys a delete acts through, with
 * whether each is accepted, the keys that may refuse it, the acceptances
 * that name nothing it acts through, and what no acceptance can fix.
 */
export function deleteReview(snapshot: MetadataSnapshot, root: ObjectRef, policy: Pick<FormPolicy, 'cascades'>): DeleteReview {
  const object = findObject(snapshot, root)
  // A root the snapshot lacks is the bindings' problem, reported as such.
  if (object === undefined) return { acting: [], restricting: [], stray: [], blocked: [], complete: false }
  if (object.referencedBy === undefined) return { acting: [], restricting: [], stray: [], blocked: [unrecorded(object.ref)], complete: false }
  const walked = walk(snapshot, object.ref)
  const blocked = blockers(walked, object.ref)
  return {
    acting: walked.acting.map(({ key, onto }) => ({ key, onto, accepted: !unaccepted(policy, key) })),
    restricting: walked.restricting.map(({ key, onto, on }) => ({ key, onto, on })),
    stray: strays(policy, walked).map(({ rule, index }) => ({ index, rule })),
    blocked: [...blocked.hidden, ...blocked.unseen, ...blocked.following, ...blocked.undeletable],
    complete: walked.hidden.length === 0 && walked.unseen.length === 0,
  }
}

/**
 * What a delete of one record of `root` reaches, as the snapshot shows it,
 * whatever the policy accepts: the tables it removes rows of, the root
 * first, and those whose references it clears, with the columns it clears.
 * Drift review compares what refers to each (0051).
 */
export function reachOf(snapshot: MetadataSnapshot, root: ObjectRef): Pick<DeleteReach, 'removed' | 'cleared'> {
  const walked = walk(snapshot, root)
  return { removed: walked.removed, cleared: walked.cleared }
}

/**
 * Every table a delete of one record of `root` reaches, as the snapshot
 * shows it: the tables it removes rows of and those whose references it
 * clears, the root first. Drift review asks of each whether the account may
 * still DELETE from it, and whether a gap hides what refers to it (0051).
 */
export function reachTables(snapshot: MetadataSnapshot, root: ObjectRef): ObjectRef[] {
  const { removed, cleared } = reachOf(snapshot, root)
  const tables = [...removed]
  for (const { table } of cleared) if (!tables.some((known) => sameRef(known, table))) tables.push(table)
  return tables
}
