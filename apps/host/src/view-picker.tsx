import { useRef, useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import type { ListFilterTerm, ListSortTerm, ListView } from '@formancy/data-client'
import { useAfterRender } from './after-render.js'
import { viewMatching } from './views.js'

/*
 * A grid's View picker (0105): the views the server offered this person for
 * the form's list, by their names, in a native select labelled View, and
 * Show view, before the Filter panel; under "Your views", the person's own
 * (0126). Not drawn when the server offered none and the person keeps
 * none.
 *
 * What it says is what the section's filter and sort are (views.ts): "All
 * records" when both are empty, a view's name when they are exactly that
 * view's, and otherwise "Your own filter and sort" -- a choice there only
 * while it is true. So a condition the person applies, or a header they
 * sort by, is said at once, and the view's own conditions put back say the
 * view again.
 *
 * A form, as the search is, and for the search's reason: nothing is sent
 * per key. Where a closed select answers an arrow with a change -- Chromium
 * on Windows and Linux, Firefox -- each step would otherwise be a pick and a
 * request, and a step off "Your own filter and sort" would throw the
 * person's conditions away. So the select holds a draft, which starts as
 * what the section shows and goes back to it whenever that changes; only
 * Show view puts the draft into the filter and the sort, together, so the
 * grid asks for one first page (record-grid.tsx), and only when the draft
 * is another choice than the section's. The keyboard stays on Show view,
 * as it stays on Search.
 *
 * While the filter and the sort are the person's own, "Name of your view"
 * and Save your view keep them under that name, on the server (0126);
 * while they are one of the person's views, Remove your view lets it go.
 * What the server answered is said on the picker's line: saved, the
 * keyboard goes to View, which now names it; refused, it stays where it
 * was, with the name as typed. A second press while the first is on its
 * way sends nothing.
 */

const ALL = 'all'
const OWN = 'own'
/** A choice of the person's own views starts with this, then its place among them. */
const MINE = 'mine-'

type Said = { kind: 'answer' | 'refused'; text: string }

export function ViewPicker({
  idBase,
  views,
  own,
  filter,
  sort,
  onPick,
  onSave,
  onRemove,
  named = '',
}: {
  /** What the select's id starts with: one picker per grid. */
  idBase: string
  /** The views the server offered this person (`list.views`), in its order. */
  views: readonly ListView[]
  /** The person's own views of the form (`list.own`, then what a save or a remove answered), in their order. */
  own: readonly ListView[]
  /** The section's filter and sort, as the grid lists by them. */
  filter: readonly ListFilterTerm[]
  sort: readonly ListSortTerm[]
  /** A view shown, or "All records": the filter and the sort the section is to list by, together. */
  onPick: (filter: ListFilterTerm[], sort: ListSortTerm[]) => void
  /** The filter and the sort kept as the person's view of this name: null once kept, else the sentence it was refused with. */
  onSave: (name: string) => Promise<string | null>
  /** The person's view of this name let go: null once gone, else the sentence it was refused with. */
  onRemove: (name: string) => Promise<string | null>
  /** What the name box holds until the person types in it: the conditions in words. */
  named?: string
}): ReactElement | null {
  const offered = viewMatching(views, filter, sort)
  const mine = offered === null ? viewMatching(own, filter, sort) : null
  const yours = offered === null && mine === null && (filter.length > 0 || sort.length > 0)
  /** The choice the section's filter and sort are. */
  const current = offered !== null ? String(views.indexOf(offered)) : mine !== null ? `${MINE}${String(own.indexOf(mine))}` : yours ? OWN : ALL
  const [draft, setDraft] = useState(current)
  // The draft goes back to what the section shows whenever that changes: a
  // view shown, a condition applied, a header pressed. Set while rendering,
  // React's way to follow a value, so no frame shows the old draft.
  const [followed, setFollowed] = useState(current)
  if (followed !== current) {
    setFollowed(current)
    setDraft(current)
  }
  /** The name typed; null until the person types one, while the box holds `named`. */
  const [typedName, setName] = useState<string | null>(null)
  const name = typedName ?? named
  const [said, setSaid] = useState<Said | null>(null)
  const sending = useRef(false)
  const [busy, setBusy] = useState(false)
  const selectRef = useRef<HTMLSelectElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const after = useAfterRender()
  const choosing = views.length > 0 || own.length > 0
  if (!choosing && !yours && said === null) return null

  function show(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (draft === current) return
    if (draft === ALL) {
      onPick([], [])
      return
    }
    const view = draft === OWN ? undefined : draft.startsWith(MINE) ? own[Number(draft.slice(MINE.length))] : views[Number(draft)]
    if (view !== undefined) onPick(view.filter, view.sort)
  }

  /** `send` once at a time, its answer said, and the keyboard taken to View or, without one, to the name box. */
  async function answer(send: () => Promise<string | null>, done: string): Promise<void> {
    if (sending.current) return
    sending.current = true
    setBusy(true)
    const refused = await send()
    sending.current = false
    setBusy(false)
    if (refused !== null) {
      setSaid({ kind: 'refused', text: refused })
      return
    }
    setSaid({ kind: 'answer', text: done })
    setName(null)
    after(() => (selectRef.current ?? nameRef.current)?.focus())
  }

  return (
    <div className="view-picker">
      {!choosing ? null : (
        <form className="view-choose" onSubmit={show}>
          <label htmlFor={`${idBase}-view`}>View</label>
          <select id={`${idBase}-view`} ref={selectRef} value={draft} onChange={(event) => setDraft(event.target.value)}>
            <option value={ALL}>All records</option>
            {views.map((view, index) => (
              <option key={view.name} value={String(index)}>
                {view.name}
              </option>
            ))}
            {own.length === 0 ? null : (
              <optgroup label="Your views">
                {own.map((view, index) => (
                  <option key={view.name} value={`${MINE}${String(index)}`}>
                    {view.name}
                  </option>
                ))}
              </optgroup>
            )}
            {yours ? <option value={OWN}>Your own filter and sort</option> : null}
          </select>
          <button type="submit" className="button">
            Show view
          </button>
        </form>
      )}
      {yours ? (
        <form
          className="view-choose"
          onSubmit={(event) => {
            event.preventDefault()
            const named = name.trim()
            void answer(() => onSave(named), `Saved your view “${named}”.`)
          }}
        >
          <label htmlFor={`${idBase}-name`}>Name of your view</label>
          <input
            id={`${idBase}-name`}
            ref={nameRef}
            type="text"
            autoComplete="off"
            spellCheck={false}
            aria-describedby={`${idBase}-said`}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <button type="submit" className="button" aria-disabled={busy ? 'true' : undefined} aria-describedby={`${idBase}-said`}>
            Save your view
          </button>
        </form>
      ) : mine !== null ? (
        <button
          type="button"
          className="button"
          aria-disabled={busy ? 'true' : undefined}
          aria-describedby={`${idBase}-said`}
          onClick={() => void answer(() => onRemove(mine.name), `Removed your view “${mine.name}”.`)}
        >
          Remove your view
        </button>
      ) : null}
      {/* Named, as Download's line is, so the grid's own line stays the section's first status with no name. */}
      <p role="status" id={`${idBase}-said`} className="status view-said" data-kind={said?.kind} aria-label="Your views">
        {said?.text ?? ''}
      </p>
    </div>
  )
}
