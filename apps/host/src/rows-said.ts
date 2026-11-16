import { listed } from './grid-datasource.js'
import type { Said } from './leave.js'
import type { ChildRows, HeldRow } from './save-set.js'

/*
 * What a together child's rows are said as (0155) -- in the grid's column
 * of each row's change, on the tab's line, in the guard's notice, after a
 * save and for a bound a save would break -- derived from the rows the
 * page holds (save-set.ts), never typed per state.
 */

/** What this person may do with a child's rows here: in a save that creates the record, or one over it as saved. */
export function mayOf(child: ChildRows): { create: boolean; update: boolean; delete: boolean; over: boolean } {
  const { together } = child.form.child
  const listedRows = child.rows.filter((row) => row.ref === null).length
  // A record already holding more rows than the form allows shows them read only (0155).
  const over = child.listing.kind === 'listed' && listedRows > together.max
  if (over) return { create: false, update: false, delete: false, over }
  return child.parent === 'new' ? { create: together.created.create, update: false, delete: false, over } : { ...together.saved, over }
}

/** `n` rows of `title`, said with the word a grid's line uses. */
export function rowsOf(n: number, title: string): string {
  return `${String(n)} ${title} ${n === 1 ? 'row' : 'rows'}`
}

/** The changes a child's rows hold now. */
export function countsOf(child: ChildRows): { held: number; added: number; changed: number; deleted: number } {
  let held = 0
  let added = 0
  let changed = 0
  let deleted = 0
  for (const row of child.rows) {
    if (row.removed) deleted += row.stored === null ? 0 : 1
    else if (row.moved !== 'gone') held += 1
    if (row.removed) continue
    if (row.ref !== null) added += 1
    else if (row.drafts?.[0]?.changed() === true) changed += 1
  }
  return { held, added, changed, deleted }
}

/** A row's change, in words: what the grid's column says. */
export function markOf(row: HeldRow): string {
  if (row.removed) return 'To be deleted'
  if (row.ref !== null) return 'New'
  if (row.moved !== null) return 'Changed by someone else'
  return row.drafts?.[0]?.changed() === true ? 'Changed' : ''
}

/** "2 Order line rows added, 1 changed and 1 to be deleted": a child's changes, or null where it holds none. */
export function changesSaid(title: string, { added, changed, deleted }: ReturnType<typeof countsOf>, removed = 'to be deleted'): string | null {
  const first = added > 0 ? 'added' : changed > 0 ? 'changed' : deleted > 0 ? removed : null
  if (first === null) return null
  const n = first === 'added' ? added : first === 'changed' ? changed : deleted
  const words = [`${rowsOf(n, title)} ${first}`]
  if (first !== 'changed' && changed > 0 && first !== removed) words.push(`${String(changed)} changed`)
  if (first !== removed && deleted > 0) words.push(`${String(deleted)} ${removed}`)
  return listed(words)
}

/** What the guard calls the record while its rows hold changes: "Order k1:7 with 2 Order line rows added and 1 to be deleted" (0047). */
export function pendingName(heading: Said, child: ChildRows): Said {
  const said = changesSaid(child.form.menu.title, countsOf(child))
  return said === null ? heading : [...heading, ` with ${said}`]
}

/**
 * The tab's line: how many rows, the bound, why a control is not there,
 * the changes held and where they are saved. "3 Order line rows; each
 * Order holds 1 to 3, so none can be added. 1 changed. Saved with the
 * Order."
 */
export function tabLine(child: ChildRows, parentNoun: string): string {
  const title = child.form.menu.title
  if (child.listing.kind === 'asking') return `Loading ${title} rows.`
  if (child.listing.kind === 'refused') return child.listing.message
  const { min, max } = child.form.child.together
  const counts = countsOf(child)
  const may = mayOf(child)
  const bound = min === max ? `exactly ${String(min)}` : min === 0 ? `at most ${String(max)}` : `${String(min)} to ${String(max)}`
  if (may.over) {
    return `${rowsOf(counts.held, title)}: more than each ${parentNoun} holds through this form, at most ${String(max)}, so they are read only here.`
  }
  // A new row is taken off the page by whoever may add one; a stored one is deleted by whoever may delete.
  const removes = child.parent === 'new' ? may.create : may.delete
  const cannot = [...(may.create && counts.held >= max ? ['added'] : []), ...(removes && counts.held <= min && counts.held > 0 ? ['removed'] : [])]
  const why = cannot.length === 0 ? '' : `, so none can be ${cannot.join(' or ')}`
  const not = [...(may.create ? [] : ['add']), ...(removes ? [] : ['remove'])]
  const denied =
    !may.create && !may.update && !may.delete ? ' You may only read them here.' : not.length > 0 ? ` You may not ${not.join(' or ')} them here.` : ''
  const changes = changesSaid(title, counts)
  return [
    `${rowsOf(counts.held, title)}; each ${parentNoun} holds ${bound}${why}.${denied}`,
    ...(changes === null ? [] : [`${changes[0]?.toUpperCase() ?? ''}${changes.slice(1)}. Saved with the ${parentNoun}.`]),
    ...(child.note === null ? [] : [child.note]),
  ].join(' ')
}

/** The page's words for a bound a save would break, from the server's numbers: "Each Order holds at least 1 Order line row; this save would leave it 0." */
export function boundSaid(parentNoun: string, title: string, rows: { min: number; max: number; held: number }): string {
  const low = rows.held < rows.min
  return `Each ${parentNoun} holds ${low ? 'at least' : 'at most'} ${rowsOf(low ? rows.min : rows.max, title)}; this save would leave it ${String(rows.held)}.`
}
