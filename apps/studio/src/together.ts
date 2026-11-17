import { generateForm, TOGETHER_MAX_ROWS, togetherBatchProblem, togetherPolicyProblems, touchColumnProblem } from '@formancy/data-core'
import type { ColumnMeta, ForeignKeyMeta, FormBindings, FormPolicy, LookupChoice, MetadataSnapshot, ObjectMeta, RowFilterRule } from '@formancy/data-core'
import type { ProposalRequest } from './api.js'

/*
 * A child's rows saved with their record, and a rowversion parent's touch
 * column (0155), as the Choose step offers them. Neither is inferred:
 * nothing here ticks a box or chooses a column. What the generator, the
 * policy check and the publish gate refuse of a choice is asked of the
 * functions the server runs -- the generator itself, in the browser, on the
 * request the step would send -- and said in their words, before anything
 * is sent.
 */

/** The bounds a lookup takes once its box is ticked: no row required, and the most a record may hold through the form, the cap data-core gives (`TOGETHER_MAX_ROWS`), one row less than a list's page. */
export const STARTING_BOUNDS = { min: 0, max: TOGETHER_MAX_ROWS } as const

/**
 * Whether the rows of `root` could be saved with the records `foreignKey`
 * references (0155): every column of the key NOT NULL, since a row with no
 * record cannot be counted under one, and onto another table, since in a
 * tree each row saved would be the record of another save. The two rules
 * of the generator's `togetherProblem` a lookup's own shape decides; what
 * else it refuses depends on the rest of the choice, and is its to say.
 */
export function togetherCandidate(root: ObjectMeta, foreignKey: ForeignKeyMeta): boolean {
  const references = foreignKey.references
  if (references === null) return false
  const own = references.table.schema === root.ref.schema && references.table.name === root.ref.name
  return !own && foreignKey.columns.every((name) => root.columns.find((column) => column.name === name)?.nullable === false)
}

/** The root's rowversion, where this connection may read it: the only concurrency a touch column is confirmed for (0155). */
export function readableRowversion(root: ObjectMeta): ColumnMeta | undefined {
  const rowversion = root.columns.find((column) => column.type.kind === 'rowversion')
  return rowversion?.access.select === true ? rowversion : undefined
}

/**
 * The columns a save of a rowversion root's rows alone could set to itself
 * (0155): the generator's own rule, `touchColumnProblem` -- no column of a
 * key or a foreign key, none generated, one this connection may both read
 * and update -- and no column a pin holds, which the generator refuses
 * too. The record's identity is one of the keys that rule already reads,
 * so it is asked with none. In catalog order, and none suggested.
 */
export function touchCandidates(root: ObjectMeta, rowFilters: readonly RowFilterRule[]): ColumnMeta[] {
  const pinned = new Set(rowFilters.map((rule) => rule.column))
  return root.columns.filter((column) => !pinned.has(column.name) && touchColumnProblem(root, [], column.name) === null)
}

type Generated = { bindings: FormBindings } | { refused: string }

/**
 * What the generator makes of `request`, asked in the browser as the server
 * asks it of a proposal: the bindings, or its sentence. The id and the
 * title are set to ones it accepts, since neither decides what a save can
 * hold, and a form id half typed would otherwise hide every reason.
 */
function generated(snapshot: MetadataSnapshot, request: ProposalRequest): Generated {
  try {
    return { bindings: generateForm(snapshot, { ...request, formId: 'together', title: 'Together' }).bindings }
  } catch (error) {
    return { refused: (error as Error).message }
  }
}

function plainLookups(lookups: readonly LookupChoice[]): LookupChoice[] {
  return lookups.map(({ together: _together, ...lookup }) => lookup)
}

/** What the step says about rows saved with their record, and the touch column, for the choice as it stands. */
export interface TogetherReasons {
  /** By foreign key, for a lookup whose box is not ticked: why the generator refuses its rows saved with their record, in its words. */
  blocked: ReadonlyMap<string, string>
  /** For the lookup whose box is ticked: what the generator, the policy check and the publish gate refuse of it, each in its own words. */
  chosen: string[]
  /** Why the generator refuses the touch column chosen, in its words; `null` for none chosen, or one it takes. */
  touch: string | null
}

const NOTHING: TogetherReasons = { blocked: new Map(), chosen: [], touch: null }

/**
 * Why each part of `request` that saves rows with their record, or names a
 * touch column, would be refused -- asked of the request without any of it
 * first, so that a refusal said here is one these choices cause. Where that
 * request is refused itself, nothing is said here: Generate sends it, and
 * says the server's refusal.
 *
 * - A lookup whose box is not ticked: the generator asked with it ticked at
 *   the starting bounds. Row security on the table, a section, a form over
 *   versions or another lookup already ticked are its refusals.
 * - The lookup ticked: the generator's refusal of it -- its bounds among
 *   them -- or, generated, what the server refuses at publish: the policy
 *   as it stands narrowing its rows by anything but their record
 *   (`togetherPolicyProblems`, the bundle check's), and on SQL Server more
 *   than one batch's parameters (`togetherBatchProblem`, the publish
 *   gate's) -- neither said of a policy that cannot be read, a pin's
 *   attribute cleared, which the server refuses before either. The policy
 *   can change after this step, and the Policy and Publish steps ask both
 *   again.
 * - The touch column: the generator's refusal of it alone.
 */
export function togetherReasons(snapshot: MetadataSnapshot, root: ObjectMeta, request: ProposalRequest, policy: FormPolicy): TogetherReasons {
  const { touchColumn, ...untouched } = request
  const plain: ProposalRequest = { ...untouched, lookups: plainLookups(request.lookups) }
  if ('refused' in generated(snapshot, plain)) return NOTHING

  const touched = touchColumn === undefined ? null : generated(snapshot, { ...plain, touchColumn })
  const touch = touched !== null && 'refused' in touched ? touched.refused : null

  const ticked = request.lookups.some((lookup) => lookup.together !== undefined)
  const asked = ticked ? generated(snapshot, untouched) : null
  const chosen =
    asked === null
      ? []
      : 'refused' in asked
        ? [`The generator refuses it: ${asked.refused}.`]
        : [
            ...togetherPolicyProblems(asked.bindings, policy).map((problem) => `The server refuses the policy with it: ${problem}.`),
            ...[togetherBatchProblem(snapshot, asked.bindings, policy)]
              .filter((problem): problem is string => problem !== null)
              .map((problem) => `Publishing refuses it: ${problem}.`),
          ]

  const blocked = new Map<string, string>()
  for (const lookup of request.lookups) {
    const foreignKey = root.foreignKeys.find((candidate) => candidate.name === lookup.foreignKey)
    if (lookup.together !== undefined || foreignKey === undefined || !togetherCandidate(root, foreignKey)) continue
    const lookups = untouched.lookups.map((entry) => (entry === lookup ? { ...entry, together: { ...STARTING_BOUNDS } } : entry))
    const outcome = generated(snapshot, { ...untouched, lookups })
    if ('refused' in outcome) blocked.set(lookup.foreignKey, outcome.refused)
  }
  return { blocked, chosen, touch }
}
