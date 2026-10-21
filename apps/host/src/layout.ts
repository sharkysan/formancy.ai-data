/*
 * The workspace's address (0047): which form is open, in which layout and
 * which view, as a fragment -- `#form=<id>&layout=<layout>&view=<view>` --
 * and never which record. A record token spells its key (0023), and a URL,
 * fragment included, goes into the browser's history, which a browser may
 * sync; so the open record lives in memory only, and a reload or a shared
 * link opens the form and its layout, never a record. The host token is in
 * no URL either (0029).
 *
 * Drill down (0090) adds `&level=<n>` to its record view: how deep the level
 * shown is, a number, never which records the levels hold. The levels are
 * in memory, so an address with a level arrives on the records too.
 *
 * A fragment rather than a query string: a fragment never leaves the
 * browser, and a query string is part of a request line a proxy may log.
 */

export const LAYOUTS = ['side-by-side', 'stacked', 'separate', 'drill'] as const
export type Layout = (typeof LAYOUTS)[number]

export const VIEWS = ['records', 'record'] as const
export type View = (typeof VIEWS)[number]

/** What the page writes into the address. */
export interface Place {
  form: string | null
  layout: Layout
  view: View
  /** In Drill down's record view, the level shown: 1 for the record, 2 for a child row of it, and so on. */
  level?: number
}

/**
 * What an address asked for. A key the page does not know, a value it does
 * not read, or a key's second spelling is left out: nothing acts on it, and
 * the page writes its own state over the address.
 */
export interface Asked {
  form: string | null
  layout: Layout | null
  view: View | null
  level: number | null
}

const KEYS = new Set(['form', 'layout', 'view', 'level'])

const isLayout = (value: string): value is Layout => (LAYOUTS as readonly string[]).includes(value)
const isView = (value: string): value is View => (VIEWS as readonly string[]).includes(value)
/** A whole number from one, as the page writes it: no sign, no leading zero, nothing after. */
const levelOf = (value: string): number | null => (/^[1-9]\d*$/.test(value) ? Number(value) : null)

/** The fragment for `place`: the form when one is open, then the layout and the view, and in Drill down's record view the level. */
export function fragmentOf(place: Place): string {
  const params = new URLSearchParams()
  if (place.form !== null) params.set('form', place.form)
  params.set('layout', place.layout)
  params.set('view', place.view)
  if (place.layout === 'drill' && place.view === 'record') params.set('level', String(place.level ?? 1))
  return `#${params.toString()}`
}

/** What `hash` -- `location.hash`, with or without its `#` -- asks for. */
export function readFragment(hash: string): Asked {
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)
  const asked: Asked = { form: null, layout: null, view: null, level: null }
  const seen = new Set<string>()
  for (const [key, value] of params) {
    if (!KEYS.has(key) || seen.has(key)) continue
    seen.add(key)
    if (key === 'form') asked.form = value
    else if (key === 'layout') asked.layout = isLayout(value) ? value : null
    else if (key === 'view') asked.view = isView(value) ? value : null
    else asked.level = levelOf(value)
  }
  return asked
}

/**
 * Where a person arrives after signing in: the fragment's form when the menu
 * names it, and never otherwise -- a form outside the menu is not asked for;
 * the fragment's layout, or Separate views on a phone (UX-SPEC D14) and Side
 * by side elsewhere; and the records view, since no record is open yet. The
 * workspace writes this place over the address it arrived on, so whatever
 * else the address said -- a key it does not read, a record token pasted in
 * -- does not stay in the history.
 */
export function arrival({ hash, menu, phone }: { hash: string; menu: readonly string[]; phone: boolean }): Place {
  const asked = readFragment(hash)
  const form = asked.form !== null && menu.includes(asked.form) ? asked.form : null
  const layout = asked.layout ?? (phone ? 'separate' : 'side-by-side')
  return { form, layout, view: 'records' }
}
