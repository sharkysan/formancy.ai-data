import type { MouseEvent, ReactElement, RefObject } from 'react'
import type { FormMenu } from '@formancy/data-client'
import { fragmentOf } from './layout.js'
import type { Layout } from './layout.js'

/**
 * The forms this person may read (0045), as the server's menu names them:
 * a sidebar on a wide window and a row of tabs on a narrower one (UX-SPEC
 * §5.4), then Sign out. Each link is named by the form's title and then its
 * id, and carries the form's fragment, so "open in a new tab" works; a click
 * goes through the unsaved-changes guard instead of navigating.
 */
export function FormsNav({
  menu,
  current,
  layout,
  headingRef,
  signOutRef,
  onChoose,
  onSignOut,
}: {
  menu: FormMenu
  current: string | null
  layout: Layout
  headingRef: RefObject<HTMLHeadingElement | null>
  signOutRef: RefObject<HTMLButtonElement | null>
  onChoose: (formId: string, link: HTMLAnchorElement) => void
  onSignOut: () => void
}): ReactElement {
  return (
    <nav className="forms" aria-label="Forms">
      <h2 className="eyebrow forms-heading" id="forms-heading" tabIndex={-1} ref={headingRef}>
        Forms
      </h2>
      {menu.forms.length === 0 ? (
        <p role="status" className="status" data-kind="loading">
          No forms you may read.
        </p>
      ) : null}
      <ul className="forms-list">
        {menu.forms.map((form) => (
          <li key={form.id}>
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
            </a>
          </li>
        ))}
      </ul>
      <div className="forms-foot">
        <button type="button" className="button" ref={signOutRef} onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </nav>
  )
}
