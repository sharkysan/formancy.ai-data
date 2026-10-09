import type { GenerationRequest, LookupChoice } from '@formancy/data-core'
import { CONFIGURATION_ID as FORM_ID } from './config-store.js'

export type GenerationReading = { ok: true; generation: GenerationRequest } | { ok: false; problems: string[] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function lookupChoices(value: unknown): LookupChoice[] | undefined {
  if (value === undefined) return []
  if (!Array.isArray(value)) return undefined
  const choices: LookupChoice[] = []
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry['foreignKey'] !== 'string') return undefined
    const display = entry['display']
    if (!Array.isArray(display) || !display.every((column) => typeof column === 'string')) return undefined
    choices.push({ foreignKey: entry['foreignKey'], display: [...(display as string[])] })
  }
  return choices
}

/**
 * One reading of a generation request, for the proposal route and for the
 * bundle check (0030), so what a proposal was generated from and what a
 * bundle says it was generated from are read by the same rules.
 *
 * Normalised: `lookups` and `pinned` are always lists, and `versionColumn` is
 * present only when it is a string. Other properties are not carried, so a
 * stored request that is not equal to its own reading holds something this
 * reading would not have produced.
 */
export function readGeneration(value: unknown): GenerationReading {
  if (!isRecord(value)) return { ok: false, problems: ['a generation request is an object'] }
  const problems: string[] = []
  const { connection, root, formId, title, versionColumn, pinned } = value
  if (typeof connection !== 'string') problems.push('connection must name a connection')
  if (!isRecord(root) || typeof root['schema'] !== 'string' || typeof root['name'] !== 'string') problems.push('root must be { schema, name }')
  if (typeof formId !== 'string' || !FORM_ID.test(formId)) problems.push('formId must be a lower-case form id')
  if (typeof title !== 'string') problems.push('title must be text')
  const lookups = lookupChoices(value['lookups'])
  if (lookups === undefined) problems.push('lookups must be a list of { foreignKey, display: [columns] }')
  const pinnedColumns = pinned === undefined ? [] : Array.isArray(pinned) && pinned.every((name) => typeof name === 'string') ? [...(pinned as string[])] : undefined
  if (pinnedColumns === undefined) problems.push('pinned must be a list of columns')
  if (versionColumn !== undefined && typeof versionColumn !== 'string') problems.push('versionColumn must name a column')
  if (problems.length > 0 || lookups === undefined || pinnedColumns === undefined || !isRecord(root)) return { ok: false, problems }
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
    },
  }
}
