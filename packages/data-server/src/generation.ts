import { ACTION_SCOPES, boundsProblem, isParameterSource, isStampChoice } from '@formancy/data-core'
import type { ActionChoice, ActionScope, GenerationRequest, LookupChoice, StampChoice } from '@formancy/data-core'
import { CONFIGURATION_ID as FORM_ID } from './config-store.js'

export type GenerationReading = { ok: true; generation: GenerationRequest } | { ok: false; problems: string[] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A lookup's `section` (0109): absent, or `{ when }`, its condition `null` or exactly a column and a value, both text. */
function sectionOf(value: unknown): { section: LookupChoice['section'] } | null {
  if (value === undefined) return { section: undefined }
  if (!isRecord(value) || Object.keys(value).length !== 1 || !Object.hasOwn(value, 'when')) return null
  const when = value['when']
  if (when === null) return { section: { when: null } }
  if (!isRecord(when) || Object.keys(when).length !== 2 || typeof when['column'] !== 'string' || typeof when['value'] !== 'string') return null
  return { section: { when: { column: when['column'], value: when['value'] } } }
}

/** A chain of versions (0113): absent, or exactly `{ from, to }`, both text; `null` for anything else. */
function validityOf(value: unknown): GenerationRequest['validity'] | null {
  if (value === undefined) return undefined
  if (!isRecord(value) || Object.keys(value).length !== 2 || typeof value['from'] !== 'string' || typeof value['to'] !== 'string') return null
  return { from: value['from'], to: value['to'] }
}

/** The columns the server stamps (0153): absent, or a list of choices, each exactly `{ column, value, on }`; `null` for anything else. */
function stampsOf(value: unknown): StampChoice[] | undefined | null {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || !value.every(isStampChoice)) return null
  return value.map((stamp) => ({ column: stamp.column, value: { ...stamp.value }, on: stamp.on }))
}

/**
 * A lookup's `together` (0155): absent, or exactly `{ min, max }`, whole
 * numbers a save can hold (`boundsProblem`), read again here so that a hand
 * edit carries nothing else to a statement; the problem with it otherwise.
 */
function togetherOf(value: unknown): { together: LookupChoice['together'] } | { problem: string } {
  if (value === undefined) return { together: undefined }
  const problem = boundsProblem(value)
  if (problem !== null) return { problem }
  const { min, max } = value as { min: number; max: number }
  return { together: { min, max } }
}

/**
 * The actions a request names (0159, 0161): absent, or a list of choices,
 * each exactly `{ name, routine: { schema, name, signature }, scope,
 * parameters: [{ parameter, from }] }`, every source one of the five
 * (`isParameterSource`), and the scope `record` or `selection` (0165);
 * `null` for anything else. Read by shape and copied, so a hand edit
 * carries nothing else; what a choice means -- a name a URL carries, one of
 * each, a routine the snapshot holds -- is the generator's to refuse. A
 * server older than 0165 refuses a stored request naming a selection, as
 * it refuses every scope it does not run.
 */
function actionsOf(value: unknown): ActionChoice[] | undefined | null {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) return null
  const choices: ActionChoice[] = []
  for (const entry of value) {
    if (!isRecord(entry) || !isRecord(entry['routine']) || !Array.isArray(entry['parameters'])) return null
    const { name, scope, routine, parameters } = entry
    if (typeof name !== 'string' || !(ACTION_SCOPES as readonly unknown[]).includes(scope)) return null
    if (typeof routine['schema'] !== 'string' || typeof routine['name'] !== 'string' || typeof routine['signature'] !== 'string') return null
    const mapped: ActionChoice['parameters'] = []
    for (const parameter of parameters as unknown[]) {
      if (!isRecord(parameter) || typeof parameter['parameter'] !== 'string' || !isParameterSource(parameter['from'])) return null
      mapped.push({ parameter: parameter['parameter'], from: { ...parameter['from'] } })
    }
    choices.push({
      name,
      routine: { schema: routine['schema'], name: routine['name'], signature: routine['signature'] },
      scope: scope as ActionScope,
      parameters: mapped,
    })
  }
  return choices
}

/** The lookup choices, or the problem with them: a list of `{ foreignKey, display, section?, together? }`. */
function lookupChoices(value: unknown): LookupChoice[] | string {
  const shape = 'lookups must be a list of { foreignKey, display: [columns], section?: { when: { column, value } | null }, together?: { min, max } }'
  if (value === undefined) return []
  if (!Array.isArray(value)) return shape
  const choices: LookupChoice[] = []
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry['foreignKey'] !== 'string') return shape
    const display = entry['display']
    if (!Array.isArray(display) || !display.every((column) => typeof column === 'string')) return shape
    const read = sectionOf(entry['section'])
    if (read === null) return shape
    const together = togetherOf(entry['together'])
    if ('problem' in together) return `lookups: ${entry['foreignKey']} is saved with its record, and ${together.problem}`
    choices.push({
      foreignKey: entry['foreignKey'],
      display: [...display],
      ...(read.section === undefined ? {} : { section: read.section }),
      ...(together.together === undefined ? {} : { together: together.together }),
    })
  }
  return choices
}

/**
 * One reading of a generation request, for the proposal route and for the
 * bundle check (0030), so what a proposal was generated from and what a
 * bundle says it was generated from are read by the same rules.
 *
 * Normalised: `lookups` and `pinned` are always lists, `versionColumn` is
 * present only when it is a string, a lookup's `section` only when it
 * marks one (0109), `validity` only when it names a chain (0113),
 * `stamps` only when it is given (0153), as given, and a lookup's
 * `together` and `touchColumn` only when they are given (0155), and
 * `actions` only when it is given (0161). Other properties are not
 * carried, so a stored request that is not equal to its own reading holds
 * something this reading would not have produced -- and a server older
 * than 0153 refuses a stored request that stamps, one older than 0155 one
 * that saves rows with their record, and one older than 0161 one that
 * names an action, as it refuses every property it does not read.
 */
export function readGeneration(value: unknown): GenerationReading {
  if (!isRecord(value)) return { ok: false, problems: ['a generation request is an object'] }
  const problems: string[] = []
  const { connection, root, formId, title, versionColumn, touchColumn, pinned, validity, stamps } = value
  if (typeof connection !== 'string') problems.push('connection must name a connection')
  if (!isRecord(root) || typeof root['schema'] !== 'string' || typeof root['name'] !== 'string') problems.push('root must be { schema, name }')
  if (typeof formId !== 'string' || !FORM_ID.test(formId)) problems.push('formId must be a lower-case form id')
  if (typeof title !== 'string') problems.push('title must be text')
  const read = lookupChoices(value['lookups'])
  const lookups = typeof read === 'string' ? undefined : read
  if (typeof read === 'string') problems.push(read)
  const pinnedColumns = pinned === undefined ? [] : Array.isArray(pinned) && pinned.every((name) => typeof name === 'string') ? [...pinned] : undefined
  if (pinnedColumns === undefined) problems.push('pinned must be a list of columns')
  if (versionColumn !== undefined && typeof versionColumn !== 'string') problems.push('versionColumn must name a column')
  if (touchColumn !== undefined && typeof touchColumn !== 'string') problems.push('touchColumn must name a column')
  const chain = validityOf(validity)
  if (chain === null) problems.push('validity must be { from, to }, two columns')
  const stamped = stampsOf(stamps)
  if (stamped === null)
    problems.push(
      "stamps must be a list of { column, value: { kind: 'actor' } | { kind: 'attribute', attribute } | { kind: 'time' }, on: 'create' | 'update' | 'both' }",
    )
  const actions = actionsOf(value['actions'])
  if (actions === null)
    problems.push("actions must be a list of { name, routine: { schema, name, signature }, scope: 'record' | 'selection', parameters: [{ parameter, from }] }")
  if (problems.length > 0 || lookups === undefined || pinnedColumns === undefined || !isRecord(root) || chain === null || stamped === null || actions === null)
    return { ok: false, problems }
  return {
    ok: true,
    generation: {
      connection: connection as string,
      root: { schema: root['schema'] as string, name: root['name'] as string },
      formId: formId as string,
      title: title as string,
      lookups,
      pinned: pinnedColumns,
      ...(typeof versionColumn === 'string' ? { versionColumn } : {}),
      ...(typeof touchColumn === 'string' ? { touchColumn } : {}),
      ...(chain === undefined ? {} : { validity: chain }),
      ...(stamped === undefined ? {} : { stamps: stamped }),
      ...(actions === undefined ? {} : { actions }),
    },
  }
}
