import { useEffect, useId, useLayoutEffect, useRef } from 'react'
import type { ReactElement, RefObject } from 'react'
import { linkWords } from './form-list.js'
import type { LinkedForm } from './form-list.js'
import { FormLink } from './form-link.js'
import type { FormLinking } from './form-link.js'

/** The forms linked to the open one (`linkedForms`), under its title. */
export interface Linked {
  title: string
  forms: readonly LinkedForm[]
}

/** What a linked form's link draws beside its words: where the open form's fields lead, rows that refer to it, or both. */
function arrows({ fields, rows }: LinkedForm): string {
  return fields && rows ? '↔' : fields ? '→' : '←'
}

/**
 * "Linked to" the open form (0144): the forms its fields lead to and those
 * whose rows refer to it, each named by its title, its id and how it is
 * linked, in words that name the open form. The arrow beside the words is
 * hidden from the accessibility tree, which would read it out as
 * "rightwards arrow"; on a phone it is all that is drawn of the way.
 */
export function LinkedForms({ linked, ...linking }: FormLinking & { linked: Linked }): ReactElement | null {
  const heading = `${useId()}-linked`
  if (linked.forms.length === 0) return null
  return (
    <div className="forms-group forms-linked">
      <h3 className="eyebrow forms-group-heading" id={heading}>
        Linked to {linked.title}
      </h3>
      <ul className="forms-list" aria-labelledby={heading}>
        {linked.forms.map((form) => (
          <li key={form.entry.id}>
            <FormLink form={form.entry} {...linking}>
              {/* A space of its own between the id and the way, so the name has one: a name is read from each element trimmed. */}{' '}
              <span className="form-link-way">
                <span aria-hidden="true">{arrows(form)}</span> <span className="form-link-words">{linkWords(form, linked.title)}</span>
              </span>
            </FormLink>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * The keyboard kept when the linked forms are drawn without the link it
 * was on: a linked form chosen opens, and while it is asked for no linked
 * form is drawn, so the browser would leave the keyboard on the page
 * itself -- for good where the form opens without moving it, as Back and
 * Forward open one. Once a commit has taken away the link that had the
 * keyboard, it goes to the same form's link in its group, or, where a
 * search left that out, to `fallback`.
 *
 * Which link has the keyboard is heard from the document's `focusin`,
 * which every move of the keyboard to an element fires -- so a person who
 * moved it on is not followed -- and a link taken out of the document
 * does not; `lists` holds the groups and the linked forms.
 */
export function useKeptKeyboard(lists: RefObject<HTMLElement | null>, fallback: () => HTMLElement | null): void {
  const held = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const heard = (event: FocusEvent): void => {
      const target = event.target
      held.current = target instanceof HTMLElement && target.closest('.forms-linked') !== null ? target : null
    }
    document.addEventListener('focusin', heard)
    return () => document.removeEventListener('focusin', heard)
  }, [])
  useLayoutEffect(() => {
    const was = held.current
    if (was === null || was.isConnected) return
    held.current = null
    const grouped = [...(lists.current?.querySelectorAll<HTMLElement>('a.form-link') ?? [])].find(
      (link) => link.dataset['form'] === was.dataset['form'] && link.closest('.forms-linked') === null,
    )
    ;(grouped ?? fallback())?.focus()
  })
}
