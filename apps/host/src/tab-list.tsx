import { useContext, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, ReactElement, ReactNode } from 'react'
import { GuardContext } from './guard.js'
import { tabMoved } from './tabs.js'

/** One tab and its panel. */
export interface TabEntry {
  /** The tab's own, the same in every render. */
  key: string
  /** What the tab says. */
  name: ReactNode
  /**
   * The panel's content, drawn the first time its tab is shown and kept,
   * hidden, after. `show` selects the panel's tab: true when another was
   * selected, and the panel is drawn on the next render.
   */
  panel: (show: () => boolean) => ReactNode
}

interface Selection {
  start: unknown
  selected: string | undefined
  /** The tabs shown since `start`, whose panels are drawn. */
  seen: readonly string[]
}

const fresh = (start: unknown, first: string | undefined): Selection => ({ start, selected: first, seen: first === undefined ? [] : [first] })

/**
 * Tabs as WAI-ARIA's pattern has them (0142), over a row named by
 * `labelledBy`: the tab selected is the row's one stop for Tab, Left and
 * Right move the selection round the row and Home and End to its ends,
 * each selecting the tab it moves to, and the next Tab goes on into the
 * panel shown, which takes the keyboard itself. A panel is drawn the
 * first time its tab is shown and kept after, hidden, so what is in it --
 * a grid's page, a row open, typing -- is there when it is shown again;
 * changing tabs therefore drops nothing.
 *
 * `start` is what the tabs are for, by identity: another selects the first
 * tab again and draws no panel but its own until another is shown. One tab
 * draws no row, and its panel no role: a row of one tab is a control that
 * does nothing. The first panel's element is the same either way, so a row
 * arriving remounts nothing already drawn in it.
 */
export function TabList({
  idBase,
  labelledBy,
  start,
  tabs,
  eager = false,
  manual = false,
  shownAlone = false,
}: {
  idBase: string
  labelledBy: string
  start: unknown
  tabs: readonly TabEntry[]
  // TEMPORARY (A): every panel drawn as the record opens.
  eager?: boolean
  // TEMPORARY (B): the arrows move the keyboard alone.
  manual?: boolean
  // TEMPORARY (H): the guard counts the forms of the tab shown alone.
  shownAlone?: boolean
}): ReactElement {
  const guard = useContext(GuardContext)
  const unguarded = useMemo(() => (guard === null ? null : { ...guard, registry: { add: () => () => true, entries: () => [] } }), [guard])
  const keys = tabs.map((tab) => tab.key)
  const [state, setState] = useState<Selection>(() => fresh(start, keys[0]))
  let now = state
  if (state.start !== start) {
    now = fresh(start, keys[0])
    setState(now)
  }
  const selected = now.selected !== undefined && keys.includes(now.selected) ? now.selected : keys[0]
  /** The tab selected as of the last render or the last select, for a panel's `show` called after either. */
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  const many = tabs.length > 1

  function select(key: string): boolean {
    if (selectedRef.current === key) return false
    selectedRef.current = key
    setState((was) => ({ ...was, selected: key, seen: was.seen.includes(key) ? was.seen : [...was.seen, key] }))
    return true
  }

  function moved(event: KeyboardEvent<HTMLDivElement>): void {
    if (selected === undefined || event.altKey || event.ctrlKey || event.metaKey) return
    const to = tabMoved(keys, selected, event.key)
    if (to === null) return
    event.preventDefault()
    if (!manual) select(to)
    buttons.current.get(to)?.focus()
  }

  const tabId = (n: number): string => `${idBase}-tab-${String(n)}`
  const panelId = (n: number): string => `${idBase}-panel-${String(n)}`

  return (
    <>
      {many ? (
        <div role="tablist" aria-labelledby={labelledBy} className="tabs" onKeyDown={moved}>
          {tabs.map((tab, n) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              id={tabId(n)}
              className="tab"
              aria-selected={tab.key === selected}
              aria-controls={panelId(n)}
              tabIndex={tab.key === selected ? 0 : -1}
              ref={(button) => {
                if (button === null) buttons.current.delete(tab.key)
                else buttons.current.set(tab.key, button)
              }}
              onClick={() => select(tab.key)}
            >
              {tab.name}
            </button>
          ))}
        </div>
      ) : null}
      {tabs.map((tab, n) => {
        const shown = tab.key === selected
        return (
          <div
            key={tab.key}
            className="tab-panel"
            {...(many ? { role: 'tabpanel', id: panelId(n), 'aria-labelledby': tabId(n), tabIndex: 0 } : {})}
            hidden={!shown}
          >
            <GuardContext.Provider value={shownAlone && !shown ? unguarded : guard}>
              {eager || shown || now.seen.includes(tab.key) ? tab.panel(() => select(tab.key)) : null}
            </GuardContext.Provider>
          </div>
        )
      })}
    </>
  )
}
