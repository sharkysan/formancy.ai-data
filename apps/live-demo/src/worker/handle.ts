/*
 * The live demo's Worker, as a function of a request and the visitor's
 * instance (0070). On Cloudflare the instance is the visitor's Durable
 * Object, and through it their container (worker.ts); whatever stands in
 * for Cloudflare elsewhere -- a key and the real server on one machine --
 * can be the instance instead. Either way the routing, the refusals, the
 * cookie and the headers are these.
 */
import { forwardedRequest, forwardFailed, jsonAnswer, methodNotAllowed, notFound, notRunning, pageSafe } from './answers.js'
import { instanceNameOf, newInstanceName } from './cookie.js'
import { routeOf } from './routes.js'
import { readSignIn, sessionIndex, signInAnswer } from './session.js'
import type { SignInResult } from './session.js'

/** A visitor's own server, as the Worker reaches it. */
export interface DemoInstance {
  /** Starts the server when none runs, and signs a token for `persona` with the key it runs with. */
  signIn(persona: string): Promise<SignInResult>
  /** The request sent to the running server; the server's not-running answer when none runs. Never starts one. */
  fetch(request: Request): Promise<Response>
}

/** The instance of `name`: the same name, the same instance. */
export type InstanceNamed = (name: string) => DemoInstance

async function signIn(request: Request, named: InstanceNamed): Promise<Response> {
  const read = await readSignIn(request)
  if (!read.ok) return read.answer
  const known = instanceNameOf(request.headers.get('cookie'))
  const name = known ?? newInstanceName()
  let result: SignInResult
  try {
    result = await named(name).signIn(read.persona.id)
  } catch {
    // The Durable Object itself failed: nothing was started for this visitor.
    result = { ok: false }
  }
  return signInAnswer(result, known === undefined ? name : undefined)
}

async function forward(request: Request, path: string, named: InstanceNamed): Promise<Response> {
  const name = instanceNameOf(request.headers.get('cookie'))
  if (name === undefined) return notRunning()
  let answer: Response
  try {
    answer = await named(name).fetch(forwardedRequest(request, path))
  } catch {
    return forwardFailed()
  }
  return pageSafe(answer)
}

/**
 * The Worker's answer to `request`: the session's list from constants; a
 * sign-in on the instance the visitor's cookie names, or on a new one; the
 * runtime plane's request forwarded to that instance; and its own 404 and
 * 405 for anything else. Only a sign-in reaches an instance's start, and
 * only a sign-in or a request whose cookie has the shape of the Worker's
 * names reaches an instance at all; a name of that shape a client wrote
 * itself reaches an instance of its own (cookie.ts).
 */
export async function handle(request: Request, named: InstanceNamed): Promise<Response> {
  const route = routeOf(request.method, new URL(request.url))
  switch (route.kind) {
    case 'session-index':
      return jsonAnswer(200, sessionIndex())
    case 'sign-in':
      return signIn(request, named)
    case 'forward':
      return forward(request, route.path, named)
    case 'method-not-allowed':
      return methodNotAllowed(route.allow)
    case 'not-found':
      return notFound()
  }
}
