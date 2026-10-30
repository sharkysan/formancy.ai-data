import { useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import { createDataClient } from '@formancy/data-client'
import type { DataClient, FormMenu } from '@formancy/data-client'
import type { DemoSession } from './demo.js'
import { PersonaSignIn } from './persona-sign-in.js'

/** Signed in: the client that speaks for the person, and the forms the server says they may read. */
export interface SignedIn {
  client: DataClient
  menu: FormMenu
}

/** Where the token is kept, said where it is asked for. */
export const TOKEN_KEPT =
  "The token is held in this tab's memory and sent only to this page's server, in the Authorization header. It is not written to storage, a cookie or the address, and reloading the page signs you out."

/** What signing in is given: the page's `fetch`, the base its routes are under, and, on the live demo's build, its session. */
interface SignInProps {
  fetch: typeof globalThis.fetch
  onSignedIn: (signedIn: SignedIn) => void
  focus?: boolean
  /** Prefixed to every route (DataClientOptions.base): `''`, the page's own origin, unless the live demo's build says otherwise. */
  base?: string
  /** The live demo's session (0070): with one, a visitor signs in as one of its people instead of pasting a token. */
  session?: DemoSession | undefined
}

/**
 * Signing in: a token from the host, or, on the live demo's build, one of
 * the demo's people (persona-sign-in.tsx). Without a session nothing of
 * the demo is drawn, and the token form is what it always was.
 */
export function SignIn({ session, base = '', focus = false, ...rest }: SignInProps): ReactElement {
  return session === undefined ? <TokenSignIn {...rest} base={base} focus={focus} /> : <PersonaSignIn {...rest} session={session} base={base} focus={focus} />
}

/**
 * Signing in with a host token, and one request -- the forms this person
 * may read (`GET /v1/forms`, 0045), which the workspace's Forms menu is.
 *
 * In a host application the person is already signed in and the
 * application's own session supplies the token; this page asks for one
 * because it has no session of its own, and says so. The token goes into
 * the client's closure and nowhere else (0029): `token: () => held` is asked
 * on every request, and the field is emptied once the menu has answered.
 * A refusal is the server's sentence, in its own words.
 *
 * `focus` takes the keyboard to the token when the question comes back after
 * Sign out, whose button went with the workspace it was on.
 */
function TokenSignIn({ fetch, onSignedIn, focus, base }: Required<Omit<SignInProps, 'session'>>): ReactElement {
  const tokenField = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (focus) tokenField.current?.focus()
  }, [focus])
  const [token, setToken] = useState('')
  const [asking, setAsking] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    // Not disabled while asking: a disabled button drops the keyboard's focus.
    if (asking) return
    setAsking(true)
    setRefusal(null)
    const held = token.trim()
    const client = createDataClient({ token: () => held, fetch, base })
    const menu = await client.forms()
    setAsking(false)
    if (!menu.ok) {
      setRefusal(menu.message)
      return
    }
    setToken('')
    onSignedIn({ client, menu: menu.value })
  }

  return (
    <section className="card signin" aria-labelledby="signin-heading">
      <h2 id="signin-heading" className="card-heading">
        Sign in
      </h2>
      <p className="lede">
        In a real host the application&rsquo;s own session supplies the token, and the person never sees it. This page has no session, so paste a token your
        host issued.
      </p>
      <form onSubmit={(event) => void submit(event)}>
        <div className="field">
          <label htmlFor="token">Host token</label>
          <input
            ref={tokenField}
            id="token"
            type="password"
            autoComplete="off"
            spellCheck={false}
            required
            aria-describedby="token-hint"
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
        </div>
        <p className="hint" id="token-hint">
          {TOKEN_KEPT}
        </p>
        <button type="submit" className="primary">
          Sign in
        </button>
        <p role="status" className="hint">
          {asking ? 'Asking the server for your forms…' : ''}
        </p>
      </form>
      {refusal === null ? null : (
        <p role="alert" className="problem-box">
          {refusal}
        </p>
      )}
    </section>
  )
}
