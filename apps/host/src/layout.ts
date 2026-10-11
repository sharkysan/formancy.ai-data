/*
 * The workspace's address (0047): which form is open, in which layout and
 * which view, as a fragment -- `#form=<id>&layout=<layout>&view=<view>` --
 * and never which record. A record token spells its key (0023), and a URL,
 * fragment included, goes into the browser's history, which a browser may
 * sync; so the open record lives in memory only, and a reload or a shared
 * link opens the form and its layout, never a record. The host token is in
 * no URL either (0029).
 *
 * A fragment rather than a query string: a fragment never leaves the
 * browser, and a query string is part of a request line a proxy may log.
 */

export const LAYOUTS = ['side-by-side', 'stacked', 'separate'] as const
export type Layout = (typeof LAYOUTS)[number]

export const VIEWS = ['records', 'record'] as const
export type View = (typeof VIEWS)[number]

/** What the page writes into the address. */
export interface Place {
  form: string | null
  layout: Layout
  view: View
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
}

const KEYS = new Set(['form', 'layout', 'view'])

const isLayout = (value: string): value is Layout => (LAYOUTS as readonly string[]).includes(value)
const isView = (value: string): value is View => (VIEWS as readonly string[]).includes(value)

/** The fragment for `place`: the form when one is open, then the layout and the view. */
export function fragmentOf(place: Place): string {
  const params = new URLSearchParams()
  if (place.form !== null) params.set('form', place.form)
  params.set('layout', place.layout)
  params.set('view', place.view)
  return `#${params.toString()}`
}

/** What `hash` -- `location.hash`, with or without its `#` -- asks for. */
export function readFragment(hash: string): Asked {
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)
  const asked: Asked = { form: null, layout: null, view: null }
  const seen = new Set<string>()
  for (const [key, value] of params) {
    if (!KEYS.has(key) || seen.has(key)) continue
    seen.add(key)
    if (key === 'form') asked.form = value
    else if (key === 'layout') asked.layout = isLayout(value) ? value : null
    else asked.view = isView(value) ? value : null
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
