import { useEffect, useRef } from 'react'
import type { ReactElement } from 'react'
import { followTerms } from '@formancy/data-core'
import type { ApiValue, BrowseEqualTerm, BrowseRelation, BrowseRelations, ObjectRef, UnfollowedKey } from '@formancy/data-core'
import { describeRef } from './choice.js'

/** A value as a sentence says it: bare, unless bare it could not be read -- empty, or with space at an end -- and then in quotes. */
const sayValue = (value: string): string => (value === '' || value.trim() !== value ? `“${value}”` : value)

/** Equal terms as a page says them: `tenant_id = 1 and customer_no = 1001`. */
export function sayTerms(terms: readonly BrowseEqualTerm[]): string {
  return terms.map((term) => `${term.column} = ${sayValue(term.value)}`).join(' and ')
}

const WHY: Readonly<Record<UnfollowedKey['reason'], string>> = {
  unseen: 'which refers to a table this connection cannot see',
  'not-browsed': 'which is outside the approved schemas',
  'not-comparable': 'whose columns this connection may not read or a browse cannot narrow by',
}

/** A key not followed, and why: the other end named where it is outside the approved schemas, which is what makes it a reason. */
function sayUnfollowed(key: UnfollowedKey): string {
  const end = key.reason === 'not-browsed' && key.object !== null ? ` ${key.direction === 'refers-to' ? 'to' : 'from'} ${describeRef(key.object)}` : ''
  return `${key.key}${end}, ${WHY[key.reason]}`
}

type Row = Readonly<Record<string, ApiValue | undefined>>

/** Columns as a sentence names them, with the verb that agrees: `tenant_id and customer_no are`. */
const sayColumns = (columns: readonly string[]): string => `${columns.join(' and ')} ${columns.length === 1 ? 'is' : 'are'}`

/**
 * One way out of the row: a button that browses the other end narrowed to
 * the row's values, named by where it goes -- or why there is none. A
 * column of the key the page does not hold, because the server's discovery
 * left it out since the studio's, is said as missing, never as NULL; one
 * that is NULL in this row makes a key that refers to no row (MATCH
 * SIMPLE), since a browse narrowed by its other columns alone would find
 * rows that merely share them.
 */
function Way({ relation, row, onFollow }: { relation: BrowseRelation; row: Row; onFollow: (object: ObjectRef, equal: BrowseEqualTerm[]) => void }): ReactElement {
  const terms = followTerms(relation, row)
  if (terms === null) {
    const missing = relation.from.filter((column) => row[column] === undefined)
    const empty = relation.from.filter((column) => row[column] === null)
    return (
      <li className="no-row">
        {relation.key}:{' '}
        {missing.length > 0 ? `${sayColumns(missing)} not on this page, so it cannot be followed.` : `${sayColumns(empty)} NULL, so it follows to no row.`}
      </li>
    )
  }
  return (
    <li>
      <button type="button" className="follow" onClick={() => onFollow(relation.to.object, terms)}>
        {describeRef(relation.to.object)} where {sayTerms(terms)}
      </button>
    </li>
  )
}

/** A list of ways out, headed by which way they go, or nothing when there is none. */
function Ways({ id, title, relations, row, onFollow }: { id: string; title: string; relations: BrowseRelation[]; row: Row; onFollow: (object: ObjectRef, equal: BrowseEqualTerm[]) => void }): ReactElement | null {
  if (relations.length === 0) return null
  return (
    <>
      <h5 id={id}>{title}</h5>
      <ul aria-labelledby={id} className="ways">
        {relations.map((relation) => (
          <Way key={`${describeRef(relation.to.object)} ${relation.key}`} relation={relation} row={row} onFollow={onFollow} />
        ))}
      </ul>
    </>
  )
}

/**
 * What the page says about its object's keys, whether or not a row can be
 * followed (0103): each key not offered, and why; and, for a table whose
 * discovery could not tell whether it listed every key referring to it,
 * that said, so a short list -- or no Related column at all -- is not read
 * as the whole one (0004). Nothing can refer to a view.
 */
export function KeyHints({ name, kind, relations }: { name: string; kind: 'table' | 'view'; relations: BrowseRelations }): ReactElement {
  return (
    <>
      {relations.unfollowed.length === 0 ? null : <p className="hint">Not followed: {relations.unfollowed.map(sayUnfollowed).join('; ')}.</p>}
      {relations.inboundComplete || kind === 'view' ? null : <p className="cannot-tell">This connection may not see every table that refers to {name}.</p>}
    </>
  )
}

/**
 * A row's related rows (0103), below the grid: what the row refers to and
 * what refers to it, each a follow the server plans again over its own
 * discovery.
 *
 * The heading takes the keyboard when the section opens, and again when
 * another row's button moves it, which remounts it by its row.
 */
export function Related({ id, name, number, row, relations, onFollow }: { id: string; name: string; number: number; row: Row; relations: BrowseRelations; onFollow: (object: ObjectRef, equal: BrowseEqualTerm[]) => void }): ReactElement {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => heading.current?.focus(), [])
  return (
    <section id={id} className="related" aria-labelledby={`${id}-heading`}>
      <h4 id={`${id}-heading`} ref={heading} tabIndex={-1}>
        Related to row {number} of <code>{name}</code>
      </h4>
      <Ways id={`${id}-out`} title="It refers to" relations={relations.relations.filter((relation) => relation.direction === 'refers-to')} row={row} onFollow={onFollow} />
      <Ways id={`${id}-in`} title="Rows that refer to it" relations={relations.relations.filter((relation) => relation.direction === 'referred-by')} row={row} onFollow={onFollow} />
    </section>
  )
}
