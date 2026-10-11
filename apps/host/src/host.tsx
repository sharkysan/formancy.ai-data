import { lazy, Suspense, useState } from 'react'
import type { MouseEvent, ReactElement } from 'react'
import { SignIn } from './sign-in.js'
import type { SignedIn } from './sign-in.js'

/**
 * The workspace, AG Grid with it, is a chunk of its own, loaded once the
 * person has signed in: the sign-in page does not wait for a grid it does
 * not draw (0047).
 */
const Workspace = lazy(() => import('./workspace.js').then((module) => ({ default: module.Workspace })))

/**
 * The host page: what a host application's people see of the forms published
 * to them, on the runtime plane and nothing else (0029, the mirror of 0024).
 * Signed out, it asks for a token; signed in, it is a workspace (0047) -- the
 * forms the person may read, a grid of a form's records, and a record's form
 * under `@formancy/react` and `@formancy/angular`, with its child rows below.
 *
 * Every request goes through the one client the sign-in made, to this page's
 * own origin. The token lives in that client's closure and nowhere else, so
 * signing out -- or reloading -- forgets it.
 *
 * The skip link puts the keyboard on main and does nothing else: it does not
 * navigate, so the address, which holds the workspace's state, and the
 * history stay as they were.
 */
export function Host({ fetch }: { fetch: typeof globalThis.fetch }): ReactElement {
  const [signedIn, setSignedIn] = useState<SignedIn | null>(null)
  // Signed out from the workspace, rather than arrived: the question takes
  // the keyboard then, and only then -- on arrival the skip link is first.
  const [signedOut, setSignedOut] = useState(false)

  const skip = (event: MouseEvent<HTMLAnchorElement>): void => {
    event.preventDefault()
    document.getElementById('host-main')?.focus()
  }

  return (
    <div className={signedIn === null ? 'page' : 'page in'}>
      <a className="skip" href="#host-main" onClick={skip}>
        Skip to the workspace
      </a>
      <header className={signedIn === null ? 'masthead' : 'masthead appbar'}>
        <p className="eyebrow">Formancy Data &middot; host</p>
        <h1>Published forms, in both renderers</h1>
        {signedIn === null ? (
          <p className="lead">
            What a host application&rsquo;s people see: the forms they may read, their records in a grid, and each record drawn
            by <code>@formancy/react</code> and <code>@formancy/angular</code> through <code>@formancy/data-client</code>.
            Every answer is the data server&rsquo;s.
          </p>
        ) : null}
      </header>

      {signedIn === null ? (
        <main id="host-main" tabIndex={-1}>
          <SignIn fetch={fetch} onSignedIn={setSignedIn} focus={signedOut} />
        </main>
      ) : (
        <Suspense
          fallback={
            <main id="host-main" tabIndex={-1}>
              <p role="status" className="hint">
                Opening the workspace…
              </p>
            </main>
          }
        >
          <Workspace
            signedIn={signedIn}
            onSignOut={() => {
              setSignedIn(null)
              setSignedOut(true)
            }}
          />
        </Suspense>
      )}

      <footer className="colophon">
        <p>Formancy Data is source-available, not open source. The formancy packages it renders with are Apache-2.0.</p>
      </footer>
    </div>
  )
}
