import { useState } from 'react'
import type { ReactElement } from 'react'
import { SignIn } from './sign-in.js'
import type { SignedIn } from './sign-in.js'
import { Workbench } from './workbench.js'

/**
 * The studio: the administrator's application from plan section 3.
 *
 * Signed out, it is a sign-in form; signed in, the workbench. The signed-in
 * state -- the client, and the token inside it -- is React state and nothing
 * else, so it ends with the page (0024).
 *
 * `fetch` is the browser's in `main.tsx`; the suite passes the real data
 * server behind a fake.
 */
export function Studio({ fetch }: { fetch: typeof globalThis.fetch }): ReactElement {
  const [signedIn, setSignedIn] = useState<SignedIn | null>(null)
  return signedIn === null ? <SignIn fetch={fetch} onSignedIn={setSignedIn} /> : <Workbench signedIn={signedIn} onSignOut={() => setSignedIn(null)} />
}
