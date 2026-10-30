/*
 * What the live demo's Worker is made of, apart from Cloudflare's runtime:
 * everything worker.ts uses but its Durable Object. Built to
 * dist/worker/pure.mjs and exported as `@formancy/data-live-demo/worker`, so
 * whatever stands in for Cloudflare -- a page's tests or browser gate in
 * front of the real server, the image's gate -- can answer
 * `/data/demo/session`, forward `/data/demo/v1/…` and sign tokens exactly
 * as the Worker does; scripts/live-demo.mjs reads the Worker's limits from
 * it, and the image's gate how much data each tenant has. A barrel: it
 * re-exports and does nothing.
 */
export {
  FORWARDED_HEADERS,
  forwardedRequest,
  forwardFailed,
  jsonAnswer,
  methodNotAllowed,
  NOT_RUNNING,
  notFound,
  notRunning,
  PAGE_SAFE_HEADERS,
  pageSafe,
  START_FAILED,
  startFailed,
  streamingOption,
  WORKER_HEADERS,
} from './answers.js'
export { COOKIE_NAME, instanceCookie, instanceNameOf, newInstanceName } from './cookie.js'
export { handle } from './handle.js'
export type { DemoInstance, InstanceNamed } from './handle.js'
export { IDLE_MINUTES, KEY_LIFETIME_MS, MAX_INSTANCES, POLL_MS, PREFIX, SIGN_IN_BYTES, START_DEADLINE_MS } from './limits.js'
export { routeOf, RUNTIME_ROUTES, SESSION_PATH } from './routes.js'
export type { Route } from './routes.js'
export { claimsFor, personaById, readSignIn, sessionIndex, signInAnswer } from './session.js'
export type { PersonaCard, SessionIndex, SignInRequest, SignInResult } from './session.js'
export { newKey, untilStopped, waitUntilHealthy } from './start.js'
export type { WaitOptions } from './start.js'
export { DEMO_FORMS, PERSONAS, ROLE_GRANTS } from '../personas.js'
export type { DemoFormId, DemoRole, FormGrants, Persona } from '../personas.js'
export { AUDIENCE, ISSUER, MIN_KEY_BYTES, mintToken, TENANT_CLAIM, TOKEN_SECONDS } from '../token.js'
export type { MintedToken, TokenClaims } from '../token.js'
export { IDENTITY_SECRET_VARIABLE, SERVER_PORT } from '../image/contract.js'
export { PER_TENANT, TENANTS } from '../data/model.js'
