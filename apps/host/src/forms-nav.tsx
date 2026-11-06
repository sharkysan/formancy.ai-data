import { useId, useRef, useState } from 'react'
import type { KeyboardEvent, MouseEvent, ReactElement, ReactNode, RefObject } from 'react'
import type { FormMenu, FormMenuEntry } from '@formancy/data-client'
import { formList, linkWords, matchSaying } from './form-list.js'
import type { LinkedForm } from './form-list.js'
import { fragmentOf } from './layout.js'
import type { Layout } from './layout.js'

/** The forms linked to the open one (`linkedForms`), under its title. */
export interface Linked {
  title: string
  forms: readonly LinkedForm[]
}

/** What a linked form's link draws beside its words: where its fields lead, where its rows come from, or both. */
function arrows({ fields, rows }: LinkedForm): string {
  return fields && rows ? '↔' : fields ? '→' : '←'
}

/**
 * The forms this person may read (0045), as the server's menu names them
 * (0144): Find a form, then the forms under their groups (0143), narrowed
 * as the person types, then the forms linked to the one open, then Sign
 * out. A sidebar on a wide window and a band of tabs on a narrower one
 * (UX-SPEC §5.4). Each link is named by the form's title and then its id
 * -- a linked form's by how it is linked too, in words -- and carries the
 * form's fragment, so "open in a new tab" works; a click goes through the
 * unsaved-changes guard instead of navigating.
 *
 * The keyboard: Tab from the box goes into the list. In the box, Enter
 * opens the one form that matches, Escape empties it, and Down moves to
 * the first form listed; on a form, Down and Up move to the next and the
 * one before, Up from the first back to the box.
 */
export function FormsNav({
  menu,
  current,
  layout,
  linked,
  headingRef,
  signOutRef,
  onChoose,
  onSignOut,
}: {
  menu: FormMenu
  current: string | null
  layout: Layout
  /** The forms linked to the open form, or null while none is open. */
  linked: Linked | null
  headingRef: RefObject<HTMLHeadingElement | null>
  signOutRef: RefObject<HTMLButtonElement | null>
  /** A form chosen; `from` is what the keyboard goes back to if the person keeps their unsaved work. */
  onChoose: (formId: string, from: HTMLElement) => void
  onSignOut: () => void
}): ReactElement {
  const ids = useId()
  const [search, setSearch] = useState('')
  const box = useRef<HTMLInputElement>(null)
  const lists = useRef<HTMLDivElement>(null)
  const list = formList(menu.forms, search)
  const only = list.matched.length === 1 ? list.matched[0] : undefined

  const link = (form: FormMenuEntry, way: ReactNode = null): ReactElement => (
    <a
      className="form-link"
      href={fragmentOf({ form: form.id, layout, view: 'records' })}
      aria-current={form.id === current ? 'page' : undefined}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        event.preventDefault()
        onChoose(form.id, event.currentTarget)
      }}
    >
      <span>{form.title}</span> <code>{form.id}</code>
      {way}
    </a>
  )

  /** The links listed, in the order they are drawn: what Down and Up move along. */
  const links = (): HTMLAnchorElement[] => [...(lists.current?.querySelectorAll<HTMLAnchorElement>('a.form-link') ?? [])]

  const onBoxKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter' && only !== undefined) {
      event.preventDefault()
      onChoose(only.id, event.currentTarget)
    } else if (event.key === 'Escape' && search !== '') {
      event.preventDefault()
      event.stopPropagation()
      setSearch('')
    } else if (event.key === 'ArrowDown') {
      const [first] = links()
      if (first === undefined) return
      event.preventDefault()
      first.focus()
    }
  }

  const onListKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const all = links()
    const at = all.indexOf(event.target as HTMLAnchorElement)
    if (at < 0) return
    event.preventDefault()
    const to = event.key === 'ArrowDown' ? all[Math.min(at + 1, all.length - 1)] : at === 0 ? box.current : all[at - 1]
    to?.focus()
  }

  const clear = (): void => {
    setSearch('')
    box.current?.focus()
  }

  return (
    <nav className="forms" aria-label="Forms">
      <h2 className="eyebrow forms-heading" id="forms-heading" tabIndex={-1} ref={headingRef}>
        Forms
      </h2>
      {menu.forms.length === 0 ? (
        <p role="status" className="status" data-kind="loading">
          No forms you may read.
        </p>
      ) : (
        <div className="forms-find">
          <label htmlFor={`${ids}-find`}>Find a form</label>
          <input
            id={`${ids}-find`}
            type="text"
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="go"
            ref={box}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={onBoxKey}
          />
          <p role="status" className="status quiet-line forms-matched">
            {matchSaying(search, list.matched.length, menu.forms.length)}
          </p>
          {search.trim() !== '' && list.matched.length === 0 ? (
            <button type="button" className="button" onClick={clear}>
              Clear the search
            </button>
          ) : null}
        </div>
      )}
      <div className="forms-lists" ref={lists} onKeyDown={onListKey}>
        {list.groups.map((group, index) => (
          <div className="forms-group" key={group.heading}>
            {list.headed ? (
              <h3 className="eyebrow forms-group-heading" id={`${ids}-group-${String(index)}`}>
                {group.heading}
              </h3>
            ) : null}
            <ul className="forms-list" aria-labelledby={list.headed ? `${ids}-group-${String(index)}` : undefined}>
              {group.forms.map((form) => (
                <li key={form.id}>{link(form)}</li>
              ))}
            </ul>
          </div>
        ))}
        {linked !== null && linked.forms.length > 0 ? (
          <div className="forms-group forms-linked">
            <h3 className="eyebrow forms-group-heading" id={`${ids}-linked`}>
              Linked to {linked.title}
            </h3>
            <ul className="forms-list" aria-labelledby={`${ids}-linked`}>
              {linked.forms.map((form) => (
                <li key={form.entry.id}>
                  {link(
                    form.entry,
                    <span className="form-link-way">
                      {' '}
                      <span aria-hidden="true">{arrows(form)}</span> <span className="form-link-words">{linkWords(form)}</span>
                    </span>,
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      <div className="forms-foot">
        <button type="button" className="button" ref={signOutRef} onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </nav>
  )
}
