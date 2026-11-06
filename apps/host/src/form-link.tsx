import type { MouseEvent, ReactElement, ReactNode } from 'react'
import type { FormMenuEntry } from '@formancy/data-client'
import { fragmentOf } from './layout.js'
import type { Layout } from './layout.js'

/** What every link of the list of forms is given: the open form, the layout, and what a press does. */
export interface FormLinking {
  current: string | null
  layout: Layout
  /** A form chosen; `from` is what the keyboard goes back to if the person keeps their unsaved work. */
  onChoose: (formId: string, from: HTMLElement) => void
}

/**
 * One form's link in the list of forms (0047, 0144): named by its title,
 * then its id, then whatever `children` say -- how a linked form is linked.
 * It carries the form's fragment, so "open in a new tab" works; a press
 * goes through the unsaved-changes guard instead of navigating. The open
 * form's is marked. `data-form` is how the list finds a form's link again.
 */
export function FormLink({ form, current, layout, onChoose, children = null }: FormLinking & { form: FormMenuEntry; children?: ReactNode }): ReactElement {
  return (
    <a
      className="form-link"
      data-form={form.id}
      href={fragmentOf({ form: form.id, layout, view: 'records' })}
      aria-current={form.id === current ? 'page' : undefined}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        event.preventDefault()
        onChoose(form.id, event.currentTarget)
      }}
    >
      <span>{form.title}</span> <code>{form.id}</code>
      {children}
    </a>
  )
}
