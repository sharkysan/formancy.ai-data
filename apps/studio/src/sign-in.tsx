import { useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import type { HostIdentity } from '@formancy/data-server'
import { createAdminClient } from './api.js'
import type { AdminClient } from './api.js'
import { IdentityList, TOKEN_KEPT } from './identity.js'

/** Who signed in, the client that speaks for them, and the connections the deployment allows. */
export interface SignedIn {
  client: AdminClient
  identity: HostIdentity
  connections: string[]
}

type Refusal = { message: string; identity?: HostIdentity }

/**
 * Signing in: a host token pasted by the operator, checked by the server.
 *
 * Two questions, asked in order, because their answers mean different
 * things. `/v1/whoami` says whether the server accepts the token at all and
 * whom it names; the connection list says whether the administrator plane
 * lets that person in. A token that passes the first and fails the second is
 * the common mistake -- a role claim mapped wrongly -- and the identity is
 * shown beside the refusal so it can be seen.
 */
export function SignIn({ fetch, onSignedIn }: { fetch: typeof globalThis.fetch; onSignedIn: (signedIn: SignedIn) => void }): ReactElement {
  const [token, setToken] = useState('')
  const [checking, setChecking] = useState(false)
  const [refusal, setRefusal] = useState<Refusal | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    // Not disabled while checking: a disabled button drops the keyboard's focus.
    if (checking) return
    setChecking(true)
    setRefusal(null)
    const client = createAdminClient({ token: token.trim(), fetch })
    const who = await client.whoami()
    if (!who.ok) {
      setChecking(false)
      setRefusal({ message: who.status === 401 ? `The server did not accept this token: ${who.message}` : who.message })
      return
    }
    const listed = await client.connections()
    setChecking(false)
    if (!listed.ok) {
      const message =
        listed.status === 403
          ? `The administrator plane refused this token: ${listed.message}`
          : listed.status === 404
            ? 'This server has no administrator plane: it was started without a configuration store and connections, so there is nothing to administer.'
            : listed.message
      setRefusal({ message, identity: who.value })
      return
    }
    setToken('')
    onSignedIn({ client, identity: who.value, connections: listed.value })
  }

  return (
    <main className="signin" aria-labelledby="signin-heading">
      <div className="signin-card">
        <p className="eyebrow">Formancy Data &middot; studio</p>
        <h1 id="signin-heading">Sign in to the studio</h1>
        <p className="lede">
          Paste a token your host application issued for you. The server checks it, says whom it names, and lets you in if
          one of its roles administers this deployment.
        </p>
        <form onSubmit={(event) => void submit(event)}>
          <label htmlFor="token">Host token</label>
          <input
            id="token"
            type="password"
            autoComplete="off"
            spellCheck={false}
            required
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
          <p className="hint">{TOKEN_KEPT}</p>
          <button type="submit" className="primary">
            Sign in
          </button>
          <p role="status" className="hint">
            {checking ? 'Checking the token with the server…' : ''}
          </p>
        </form>
        {refusal === null ? null : (
          <>
            <p role="alert" className="problem-box">
              {refusal.message}
            </p>
            {refusal.identity === undefined ? null : (
              <section aria-labelledby="named-heading" className="named">
                <h2 id="named-heading">Who this token names</h2>
                <IdentityList identity={refusal.identity} />
              </section>
            )}
          </>
        )}
      </div>
    </main>
  )
}
