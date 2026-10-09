import { useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import { createDataClient } from '@formancy/data-client'
import type { DataClient, PublishedForm } from '@formancy/data-client'

/** A form opened: the client that speaks for the person, and the definition the server gave. */
export interface OpenForm {
  client: DataClient
  formId: string
  definition: PublishedForm
}

/** Where the token is kept, said where it is asked for. */
export const TOKEN_KEPT =
  "The token is held in this tab's memory and sent only to this page's server, in the Authorization header. It is not written to storage, a cookie or the address, and reloading the page signs you out."

/**
 * Opening a published form: a host token and a form id, and one request.
 *
 * In a host application the person is already signed in and the application's
 * own session supplies the token; this page asks for one because it has no
 * session of its own, and says so. The token goes into the client's closure
 * and nowhere else (0029): `token: () => held` is asked on every request, and
 * the field is emptied once the form opens.
 *
 * The definition is the only thing asked for here. What the person may do
 * with it -- read, create, update -- is the server's answer, and so is a
 * refusal, shown in its own words.
 *
 * `focus` takes the keyboard to the token when the question comes back after
 * Sign out, whose button went with the form it was on.
 */
export function SignIn({ fetch, onOpen, focus = false }: { fetch: typeof globalThis.fetch; onOpen: (opened: OpenForm) => void; focus?: boolean }): ReactElement {
  const tokenField = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (focus) tokenField.current?.focus()
  }, [focus])
  const [token, setToken] = useState('')
  const [formId, setFormId] = useState('')
  const [opening, setOpening] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    // Not disabled while opening: a disabled button drops the keyboard's focus.
    if (opening) return
    setOpening(true)
    setRefusal(null)
    const held = token.trim()
    const client = createDataClient({ token: () => held, fetch })
    const id = formId.trim()
    const definition = await client.form(id)
    setOpening(false)
    if (!definition.ok) {
      setRefusal(definition.message)
      return
    }
    setToken('')
    onOpen({ client, formId: id, definition: definition.value })
  }

  return (
    <section className="card signin" aria-labelledby="signin-heading">
      <h2 id="signin-heading" className="card-heading">Open a published form</h2>
      <p className="lede">
        In a real host the application&rsquo;s own session supplies the token, and the person never sees it. This page has
        no session, so paste a token your host issued and the id of a published form.
      </p>
      <form onSubmit={(event) => void submit(event)}>
        <div className="field">
          <label htmlFor="token">Host token</label>
          <input ref={tokenField} id="token" type="password" autoComplete="off" spellCheck={false} required value={token} onChange={(event) => setToken(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="form-id">Form id</label>
          <input id="form-id" type="text" autoComplete="off" spellCheck={false} required value={formId} onChange={(event) => setFormId(event.target.value)} />
        </div>
        <p className="hint">{TOKEN_KEPT}</p>
        <button type="submit" className="primary">
          Open the form
        </button>
        <p role="status" className="hint">
          {opening ? 'Asking the server for the form…' : ''}
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
