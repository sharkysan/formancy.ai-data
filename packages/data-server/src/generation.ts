import type { GenerationRequest, LookupChoice } from '@formancy/data-core'
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

function lookupChoices(value: unknown): LookupChoice[] | undefined {
  if (value === undefined) return []
  if (!Array.isArray(value)) return undefined
  const choices: LookupChoice[] = []
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry['foreignKey'] !== 'string') return undefined
    const display = entry['display']
    if (!Array.isArray(display) || !display.every((column) => typeof column === 'string')) return undefined
    const read = sectionOf(entry['section'])
    if (read === null) return undefined
    choices.push({ foreignKey: entry['foreignKey'], display: [...(display as string[])], ...(read.section === undefined ? {} : { section: read.section }) })
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
 * marks one (0109), and `validity` only when it names a chain (0113). Other properties are not carried, so a
 * stored request that is not equal to its own reading holds something this
 * reading would not have produced.
 */
export function readGeneration(value: unknown): GenerationReading {
  if (!isRecord(value)) return { ok: false, problems: ['a generation request is an object'] }
  const problems: string[] = []
  const { connection, root, formId, title, versionColumn, pinned, validity } = value
  if (typeof connection !== 'string') problems.push('connection must name a connection')
  if (!isRecord(root) || typeof root['schema'] !== 'string' || typeof root['name'] !== 'string') problems.push('root must be { schema, name }')
  if (typeof formId !== 'string' || !FORM_ID.test(formId)) problems.push('formId must be a lower-case form id')
  if (typeof title !== 'string') problems.push('title must be text')
  const lookups = lookupChoices(value['lookups'])
  if (lookups === undefined) problems.push('lookups must be a list of { foreignKey, display: [columns], section?: { when: { column, value } | null } }')
  const pinnedColumns = pinned === undefined ? [] : Array.isArray(pinned) && pinned.every((name) => typeof name === 'string') ? [...(pinned as string[])] : undefined
  if (pinnedColumns === undefined) problems.push('pinned must be a list of columns')
  if (versionColumn !== undefined && typeof versionColumn !== 'string') problems.push('versionColumn must name a column')
  const chain = validityOf(validity)
  if (chain === null) problems.push('validity must be { from, to }, two columns')
  if (problems.length > 0 || lookups === undefined || pinnedColumns === undefined || !isRecord(root) || chain === null) return { ok: false, problems }
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
      ...(chain === undefined ? {} : { validity: chain }),
    },
  }
}
