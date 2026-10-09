import { useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import type { LookupOperation } from '@formancy/data-client'
import { Pane } from './pane.js'
import { RecordBar } from './record-bar.js'
import { createSession } from './session.js'
import { SignIn } from './sign-in.js'
import type { OpenForm } from './sign-in.js'

/** What each operation is called in the sentence that lists them. */
const VERBS: Readonly<Record<LookupOperation, string>> = { read: 'read', create: 'create', update: 'update' }

/** `['read', 'create', 'update']` as "read, create and update". */
function listed(operations: readonly LookupOperation[]): string {
  const words = operations.map((operation) => VERBS[operation])
  return words.length < 2 ? (words[0] ?? 'nothing') : `${words.slice(0, -1).join(', ')} and ${String(words.at(-1))}`
}

/**
 * The open form: the record bar, what the definition allows, and the two
 * panes. Each pane has its own session -- its own engine, record, version
 * and draft -- over one client and one definition.
 */
function Workspace({ opened, onSignOut }: { opened: OpenForm; onSignOut: () => void }): ReactElement {
  const { client, formId, definition } = opened
  const sessions = useMemo(
    () => [createSession({ client, formId, definition, renderer: 'react' }), createSession({ client, formId, definition, renderer: 'angular' })],
    [client, formId, definition],
  )
  const title = sessions[0]?.opened().engine.text(definition.form.title) ?? formId

  // The sign-in form the keyboard was on is gone: the next thing to do is
  // choose a record, so the keyboard goes there rather than to the page.
  useEffect(() => {
    document.getElementById('record-token')?.focus()
  }, [])

  return (
    <>
      <RecordBar client={client} formId={formId} sessions={sessions} />
      <div className="card form-line">
        <p>
          <code>{formId}</code>: you may {listed(definition.operations)} records with this form.
        </p>
        <button type="button" className="button" onClick={onSignOut}>
          Sign out
        </button>
      </div>
      <div className="panes">
        {sessions.map((session) => (
          <Pane key={session.renderer} session={session} title={title} />
        ))}
      </div>
    </>
  )
}

/**
 * The host page: what a host application's people see of one published form,
 * on the runtime plane and nothing else (0029, the mirror of 0024). Signed
 * out, it asks for a token and a form; open, it renders the form under
 * `@formancy/react` and `@formancy/angular` side by side.
 *
 * Every request goes through the one client the sign-in made, to this page's
 * own origin. The token lives in that client's closure and nowhere else, so
 * signing out -- or reloading -- forgets it.
 */
export function Host({ fetch }: { fetch: typeof globalThis.fetch }): ReactElement {
  const [opened, setOpened] = useState<OpenForm | null>(null)
  // Signed out from the open form, rather than arrived: the question takes
  // the keyboard then, and only then -- on arrival the skip link is first.
  const [signedOut, setSignedOut] = useState(false)

  return (
    <div className="page">
      <a className="skip" href="#host-main">
        Skip to the form
      </a>
      <header className="masthead">
        <p className="eyebrow">Formancy Data &middot; host</p>
        <h1>A published form, in both renderers</h1>
        <p className="lead">
          What a host application&rsquo;s people see: one form the studio published, loaded, edited, saved and searched
          through <code>@formancy/data-client</code>, and drawn by <code>@formancy/react</code> and{' '}
          <code>@formancy/angular</code> side by side. Every answer is the data server&rsquo;s.
        </p>
      </header>

      <main id="host-main" tabIndex={-1}>
        {opened === null ? (
          <SignIn fetch={fetch} onOpen={setOpened} focus={signedOut} />
        ) : (
          <Workspace
            opened={opened}
            onSignOut={() => {
              setOpened(null)
              setSignedOut(true)
            }}
          />
        )}
      </main>

      <footer className="colophon">
        <p>Formancy Data is source-available, not open source. The formancy packages it renders with are Apache-2.0.</p>
      </footer>
    </div>
  )
}
