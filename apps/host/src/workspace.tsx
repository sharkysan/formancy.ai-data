import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { FormMenuEntry, PublishedForm } from '@formancy/data-client'
import { useAddressRequests, useHistory } from './address.js'
import { useAfterRender } from './after-render.js'
import type { ChildForm } from './children.js'
import { FormView } from './form-view.js'
import { FormsNav } from './forms-nav.js'
import { GuardContext, useGuard } from './guard.js'
import { arrival } from './layout.js'
import type { Layout, Place, View } from './layout.js'
import { browserStorage, readRenderer, readSplit, writeRenderer, writeSplit } from './prefs.js'
import type { RendererChoice } from './prefs.js'
import type { SignedIn } from './sign-in.js'
import { UnsavedNotice } from './unsaved-notice.js'

/** Whether the window matches `query`, as it changes; false where there is no `matchMedia` (jsdom). */
function useMedia(query: string): boolean {
  const list = useMemo(() => (typeof window.matchMedia === 'function' ? window.matchMedia(query) : null), [query])
  const [matches, setMatches] = useState(list?.matches ?? false)
  useEffect(() => {
    if (list === null) return undefined
    const changed = (): void => setMatches(list.matches)
    list.addEventListener('change', changed)
    return () => list.removeEventListener('change', changed)
  }, [list])
  return matches
}

/** The form open in main: asked for, refused, or open with its children. */
type Opened = { entry: FormMenuEntry; state: 'asking' } | { entry: FormMenuEntry; state: 'refused'; message: string } | { entry: FormMenuEntry; state: 'open'; definition: PublishedForm; children: ChildForm[] }

/**
 * The host page's workspace (0047), the chunk loaded after sign-in, AG Grid
 * with it: the Forms the person may read, and the open form in main. It
 * holds what spans forms -- the address, the layout, the renderer choice,
 * the split, and the unsaved-changes guard -- and FormView holds one form.
 *
 * The address is `#form=…&layout=…&view=…` and never a record (layout.ts):
 * choosing a form and changing the view in Separate views push an entry, a
 * layout change replaces it, and Back, Forward or a typed fragment go
 * through the guard (address.ts). A form's definition that answers after
 * another form was chosen is dropped, a refusal included.
 */
export function Workspace({ signedIn, onSignOut }: { signedIn: SignedIn; onSignOut: () => void }): ReactElement {
  const { client, menu } = signedIn
  const guard = useGuard()
  const after = useAfterRender()
  const storage = useMemo(browserStorage, [])
  const ids = useMemo(() => menu.forms.map((form) => form.id), [menu])
  const narrow = useMedia('(max-width: 56rem)')
  const [first] = useState(() => arrival({ hash: window.location.hash, menu: ids, phone: typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 40rem)').matches }))
  const [place, setPlaceState] = useState<Place>({ form: null, layout: first.layout, view: 'records' })
  const placeRef = useRef(place)
  const [opened, setOpened] = useState<Opened | null>(null)
  const [renderer, setRenderer] = useState<RendererChoice>(() => readRenderer(storage))
  const [split, setSplit] = useState(() => readSplit(storage))
  const formsHeading = useRef<HTMLHeadingElement>(null)
  const formHeading = useRef<HTMLHeadingElement>(null)
  const signOutRef = useRef<HTMLButtonElement>(null)
  const history = useHistory()
  const { write } = history
  /** How many times a form has been asked for: an answer for an earlier one is not the form the person chose last. */
  const asking = useRef(0)

  const setPlace = useCallback((next: Place) => {
    placeRef.current = next
    setPlaceState(next)
  }, [])

  const menuEntry = useCallback((id: string) => menu.forms.find((form) => form.id === id), [menu])

  const openForm = useCallback(
    async (id: string, { focus, push }: { focus: boolean; push: boolean }) => {
      const chosen = menuEntry(id)
      if (chosen === undefined) return
      asking.current += 1
      const mine = asking.current
      const next: Place = { form: id, layout: placeRef.current.layout, view: 'records' }
      setPlace(next)
      write(next, push)
      setOpened({ entry: chosen, state: 'asking' })
      const definition = await client.form(id)
      // Another form was chosen while this one was asked for: its answer, a refusal included, is not what main shows.
      if (asking.current !== mine) return
      if (!definition.ok) {
        setOpened({ entry: chosen, state: 'refused', message: definition.message })
        if (focus) after(() => formHeading.current?.focus())
        return
      }
      // The children the menu names, each opened as itself: its own policy
      // decides what its list returns, and a child the server no longer lists
      // for this person now is left out (0045).
      const children = await Promise.all(
        chosen.children
          .filter((child) => ids.includes(child.form))
          .map(async (child) => {
            const answer = await client.form(child.form)
            const own = menuEntry(child.form)
            return answer.ok && answer.value.list !== null && own !== undefined ? { child, menu: own, definition: answer.value } : null
          }),
      )
      if (asking.current !== mine) return
      setOpened({ entry: chosen, state: 'open', definition: definition.value, children: children.filter((child): child is ChildForm => child !== null) })
      if (focus) after(() => formHeading.current?.focus())
    },
    [client, ids, menuEntry, setPlace, write, after],
  )

  // Arriving: the keyboard on Forms, the fragment's form opened when the
  // menu names it, and the entry the page arrived on marked as its own --
  // an address it does not read written over.
  useEffect(() => {
    formsHeading.current?.focus()
    if (first.form !== null) void openForm(first.form, { focus: false, push: false })
    else write(placeRef.current, false)
    // Once, on arrival: what the address said when the person signed in.
  }, [])

  const choose = (id: string, link: HTMLAnchorElement): void => {
    if (id === placeRef.current.form) {
      formHeading.current?.focus()
      return
    }
    const chosen = menuEntry(id)
    guard.ask({ kind: 'form', title: chosen?.title ?? id }, () => void openForm(id, { focus: true, push: true }), () => link.focus())
  }

  // Back, Forward, and a fragment typed into the address bar.
  const historyView = useAddressRequests({ guard, ids, menuEntry, openForm, setPlace, placeRef, history })

  const changeLayout = (layout: Layout): void => {
    const next: Place = { ...placeRef.current, layout, view: 'records' }
    setPlace(next)
    write(next, false)
  }

  const changeView = (view: View): void => {
    const next: Place = { ...placeRef.current, view }
    setPlace(next)
    write(next, true)
  }

  const chooseRenderer = (choice: RendererChoice): void => {
    setRenderer(choice)
    writeRenderer(storage, choice)
  }

  const signOut = (): void => guard.ask({ kind: 'sign-out' }, onSignOut, () => signOutRef.current?.focus())

  return (
    <div className="workspace">
      <FormsNav menu={menu} current={place.form} layout={place.layout} headingRef={formsHeading} signOutRef={signOutRef} onChoose={choose} onSignOut={signOut} />
      <main id="host-main" className="workspace-main" tabIndex={-1} aria-labelledby={opened === null ? undefined : 'form-heading'}>
        {opened === null ? (
          <section className="panel nothing" aria-labelledby="no-form-heading">
            <h2 id="no-form-heading" className="section-heading">
              No form open
            </h2>
            <p className="hint">Choose a form under Forms.</p>
          </section>
        ) : opened.state === 'open' ? (
          <GuardContext.Provider value={guard}>
            <FormView
              key={opened.entry.id}
              client={client}
              entry={opened.entry}
              definition={opened.definition}
              childForms={opened.children}
              layout={place.layout}
              view={place.view}
              historyView={historyView}
              narrow={narrow}
              renderer={renderer}
              split={split}
              notice={guard.pending === null ? null : <UnsavedNotice pending={guard.pending} onKeep={guard.keep} onDiscard={guard.discard} />}
              headingRef={formHeading}
              onLayout={changeLayout}
              onView={changeView}
              onRenderer={chooseRenderer}
              onSplit={setSplit}
              onSplitSettled={(share) => writeSplit(storage, share)}
            />
          </GuardContext.Provider>
        ) : (
          <section className="panel nothing" aria-labelledby="form-heading">
            <h2 id="form-heading" className="form-title" tabIndex={-1} ref={formHeading}>
              <span>{opened.entry.title}</span> <code>{opened.entry.id}</code>
            </h2>
            {opened.state === 'asking' ? (
              <p role="status" className="status" data-kind="loading">
                Asking the server for the form…
              </p>
            ) : (
              <p role="alert" className="problem-box">
                {opened.message}
              </p>
            )}
          </section>
        )}
      </main>
    </div>
  )
}
