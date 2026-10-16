import type { NormalizedType, NormalizedTypeKind } from '../metadata.js'
import type { LookupSearchColumn, LookupSearchType } from './types.js'

/*
 * What a typed search may match, decided once. A lookup's search
 * (`config.ts`), the control the generator draws for it (0066) and the
 * columns a record list may be searched by (`records/list.ts`) all read this
 * set, so a column the person can search is one the server agrees to search.
 *
 * Type imports only: `generate/` reads this file, and `config.ts` imports
 * `generate/version.ts`, so the generator never imports `config.ts`.
 */

/** Kinds both engines spell alike as text, so a search over them matches what the label shows. */
export const SEARCHABLE_KINDS: ReadonlySet<NormalizedTypeKind> = new Set<LookupSearchType['kind']>(['text', 'integer'])

function isSearchType(type: NormalizedType): type is LookupSearchType {
  return SEARCHABLE_KINDS.has(type.kind)
}

/**
 * The display columns a typed search matches when nobody chose them: the
 * first time the label shows each text or integer column, in the label's
 * order, each with its type, because an adapter matches an integer as its
 * canonical text (0028). Empty when the label shows neither, and then the
 * lookup is a plain select of its first page (0066).
 */
export function searchableDisplay(columns: readonly { name: string; type: NormalizedType }[]): LookupSearchColumn[] {
  const seen = new Set<string>()
  const searched: LookupSearchColumn[] = []
  for (const column of columns) {
    if (seen.has(column.name)) continue
    seen.add(column.name)
    if (isSearchType(column.type)) searched.push({ name: column.name, type: column.type })
  }
  return searched
}
