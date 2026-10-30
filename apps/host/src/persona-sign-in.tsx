import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { createDataClient } from '@formancy/data-client'
import type { DemoSession, PersonaCard, SessionIndex } from './demo.js'
import type { SignedIn } from './sign-in.js'

/** Where the source is, which the page says because formancy.ai/data/demo/ is reached without the README (0070), as the examples page does (0069). */
const REPOSITORY = 'https://github.com/sharkysan/formancy.ai-data'

/** What the page says while the Worker starts the visitor's server, whose start deploy/demo/Dockerfile's header measures. */
const STARTING = 'Starting your own server and database: the first start takes a few seconds.'

type Asking = 'people' | 'starting' | 'forms' | null

const ASKING: Readonly<Record<Exclude<Asking, null>, string>> = {
  people: 'Asking the demo who you may sign in as…',
  starting: STARTING,
  forms: 'Asking your server for your forms…',
}

/**
 * Signing in to the live demo (0070): the people the demo's Worker lists,
 * each a button that starts the visitor's own server when none runs and
 * answers a token for that person -- then the one request the token form
 * makes, the forms this person may read (0045), through a client made
 * exactly as the token form makes it, at the demo's `base`. The token goes
 * into the client's closure and nowhere else (0029).
 *
 * Each button is described by what that person may do, in the Worker's
 * words, which are derived from the policy the image publishes. A refusal
 * -- a start that failed, a server that has stopped -- is the Worker's or
 * the server's sentence. The buttons are not disabled while a sign-in is
 * under way, for the token form's reason: a disabled button drops the
 * keyboard's focus. `focus` takes the keyboard to the first person when
 * the question comes back after Sign out.
 */
export function PersonaSignIn({
  session,
  fetch,
  base,
  onSignedIn,
  focus,
}: {
  session: DemoSession
  fetch: typeof globalThis.fetch
  base: string
  onSignedIn: (signedIn: SignedIn) => void
  focus: boolean
}): ReactElement {
  const [index, setIndex] = useState<SessionIndex | null>(null)
  const [asking, setAsking] = useState<Asking>('people')
  const [refusal, setRefusal] = useState<string | null>(null)
  const first = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    let current = true
    void session.personas().then((answer) => {
      if (!current) return
      setAsking(null)
      if (answer.ok) setIndex(answer.value)
      else setRefusal(answer.message)
    })
    return () => {
      current = false
    }
  }, [session])

  useEffect(() => {
    if (focus && index !== null) first.current?.focus()
  }, [focus, index])

  async function signInAs(persona: PersonaCard): Promise<void> {
    if (asking !== null) return
    setAsking('starting')
    setRefusal(null)
    const started = await session.signIn(persona.id)
    if (!started.ok) {
      setAsking(null)
      setRefusal(started.message)
      return
    }
    const held = started.value.token
    const client = createDataClient({ token: () => held, fetch, base })
    setAsking('forms')
    const menu = await client.forms()
    setAsking(null)
    if (!menu.ok) {
      setRefusal(menu.message)
      return
    }
    onSignedIn({ client, menu: menu.value })
  }

  return (
    <section className="card signin" aria-labelledby="signin-heading">
      <h2 id="signin-heading" className="card-heading">
        Sign in
      </h2>
      {index === null ? null : (
        <>
          <p className="lede">
            Choose who to be. A data server and a PostgreSQL database of your own start on Cloudflare, with sample sales data of the tenants these people work
            in. They stop {index.idleMinutes} minutes after your last request, and everything you changed goes with them.
          </p>
          <ul className="personas" aria-label="People">
            {index.personas.map((persona, at) => (
              <li key={persona.id}>
                <button
                  ref={at === 0 ? first : undefined}
                  type="button"
                  className="primary"
                  aria-describedby={`persona-${persona.id}`}
                  onClick={() => void signInAs(persona)}
                >
                  Sign in as {persona.name}
                </button>
                <p className="hint" id={`persona-${persona.id}`}>
                  {persona.description}
                </p>
              </li>
            ))}
          </ul>
          <p className="hint">
            One cookie holds a random name for your server and nothing else. Whoever holds it can sign in to your server, so it goes only to this demo&rsquo;s
            own addresses, no script can read it, and your browser keeps it no longer than its session. The token for the person you choose is held in this
            tab&rsquo;s memory and sent only in the Authorization header; reloading the page signs you out, and your server keeps your changes until it stops.
          </p>
          <p className="standing">
            Formancy Data is source-available: <a href={REPOSITORY}>sharkysan/formancy.ai-data</a> on GitHub.
          </p>
        </>
      )}
      <p role="status" className="hint">
        {asking === null ? '' : ASKING[asking]}
      </p>
      {refusal === null ? null : (
        <p role="alert" className="problem-box">
          {refusal}
        </p>
      )}
    </section>
  )
}
