import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, ReactElement, RefObject } from 'react'
import type { FormMenu } from '@formancy/data-client'
import { FindForm, plain } from './find-form.js'
import { FormGroups } from './form-groups.js'
import { formList } from './form-list.js'
import type { Layout } from './layout.js'
import { LinkedForms, useKeptKeyboard } from './linked-forms.js'
import type { Linked } from './linked-forms.js'

/**
 * The forms this person may read (0045), as the server's menu names them
 * (0144): Find a form (`find-form.tsx`), then the forms under their groups
 * (`form-groups.tsx`, 0143), narrowed as the person types, then the forms
 * linked to the one open (`linked-forms.tsx`), then Sign out. A sidebar on
 * a wide window and a band of tabs on a narrower one (UX-SPEC §5.4). The
 * search narrows the groups and not the linked forms, and stays as typed
 * after a form is chosen until the person empties it.
 *
 * The keyboard: Tab from the box goes into the list, Down from the box to
 * its first form; on a form, Down and Up without a modifier move to the
 * next and the one before, through the groups and the linked forms, and Up
 * from the first back to the box.
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
  const [search, setSearch] = useState('')
  const box = useRef<HTMLInputElement>(null)
  const lists = useRef<HTMLDivElement>(null)
  const list = formList(menu.forms, search)
  const linking = { current, layout, onChoose }
  // TEMPORARY M13: the box emptied whenever the open form changes.
  useEffect(() => setSearch(''), [current])
  useKeptKeyboard(lists, () => box.current ?? headingRef.current)

  /** The links listed, in the order they are drawn: what Down and Up move along. */
  const links = (): HTMLAnchorElement[] => [...(lists.current?.querySelectorAll<HTMLAnchorElement>('a.form-link') ?? [])]

  const onListKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    if ((event.key !== 'ArrowDown' && event.key !== 'ArrowUp') || !plain(event)) return
    // TEMPORARY M5: the list's links unread on Down and Up.
    const all: HTMLAnchorElement[] = []
    const at = all.findIndex((link) => link === event.target)
    if (at < 0) return
    event.preventDefault()
    const to = event.key === 'ArrowDown' ? all[Math.min(at + 1, all.length - 1)] : at === 0 ? box.current : all[at - 1]
    to?.focus()
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
        <FindForm
          search={search}
          matched={list.matched}
          total={menu.forms.length}
          box={box}
          onSearch={setSearch}
          // TEMPORARY M11: the matching form's link handed to the guard in place of the box.
          onChoose={(id, from) => onChoose(id, links().find((link) => link.dataset['form'] === id) ?? from)}
          onDown={() => {
            const [first] = links()
            first?.focus()
            return first !== undefined
          }}
        />
      )}
      {/* TEMPORARY M7: while a search is typed, the lists' container is a listbox without options. */}
      <div className="forms-lists" ref={lists} onKeyDown={onListKey} role={search === '' ? undefined : 'listbox'}>
        {/* TEMPORARY M2: the groups drawn from every form whatever was typed. */}
        <FormGroups list={formList(menu.forms, '')} {...linking} />
        {/* TEMPORARY M14: the linked forms narrowed by the search too. */}
        {linked === null ? null : <LinkedForms linked={{ ...linked, forms: linked.forms.filter((form) => list.matched.includes(form.entry)) }} {...linking} />}
      </div>
      <div className="forms-foot">
        <button type="button" className="button" ref={signOutRef} onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </nav>
  )
}
