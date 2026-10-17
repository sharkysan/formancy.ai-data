/*
 * The demo's forms published through the real administrator plane, over
 * HTTP, as an administrator in the studio publishes one: a proposal from
 * the snapshot the demo's account discovers, then a bundle of format 2
 * with `expectedBase: null`, as scripts/getting-started/journey.mjs
 * publishes the guide's. The image's build runs it against the server it
 * starts for that (image/cli.ts), and publish.integration.test.ts against
 * the same server in process, over a socket, with the same files loaded.
 */
import type { FormBindings, GenerationNote } from '@formancy/data-core'
import type { DemoFormId } from '../personas.js'
import { DEMO_FORM_SPECS, demoBundle, generationRequest } from './forms.js'
import type { DemoFormSpec, Proposal } from './forms.js'

export interface PublishTarget {
  /** The server's origin, `http://127.0.0.1:4390` in the image's build. */
  base: string
  /** An administrator's token, sent in the Authorization header only. */
  token: string
  fetch?: typeof fetch
}

/** One form as published: the account its snapshot was discovered as, what its bindings offer, and what the generator noted. */
export interface PublishedForm {
  id: DemoFormId
  account: string
  offers: FormBindings['operations']
  notes: GenerationNote[]
  milliseconds: number
}

interface Answer {
  status: number
  json: unknown
}

/** A POST with a JSON body, as an administrator's client sends it; an answer that is not JSON -- a proxy's error page -- is read as no body. */
async function post(target: PublishTarget, path: string, body: unknown): Promise<Answer> {
  const response = await (target.fetch ?? fetch)(new URL(path, target.base), {
    method: 'POST',
    headers: { authorization: `Bearer ${target.token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  })
  const text = await response.text()
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    json = undefined
  }
  return { status: response.status, json }
}

/**
 * A sentence for an answer that is not the one expected: the server's own
 * code and message, and a refused bundle's problems, which name forms,
 * fields, keys and roles and never a token or a password.
 */
function unexpected(what: string, answer: Answer, expected: number): Error {
  const said = answer.json as { code?: unknown; message?: unknown; problems?: unknown } | undefined
  const reason = typeof said?.message === 'string' ? `: ${String(said.code)} ${said.message}` : ''
  const problems = Array.isArray(said?.problems) ? said.problems.filter((problem): problem is string => typeof problem === 'string') : []
  return new Error(`${what} answered ${String(answer.status)}, not ${String(expected)}${reason}${problems.map((problem) => `\n  ${problem}`).join('')}`)
}

async function publishOne(target: PublishTarget, spec: DemoFormSpec): Promise<PublishedForm> {
  const started = Date.now()
  const proposed = await post(target, '/v1/form-proposals', generationRequest(spec))
  if (proposed.status !== 200) throw unexpected(`${spec.id}: POST /v1/form-proposals`, proposed, 200)
  const proposal = proposed.json as Proposal
  const bundle = demoBundle(spec, proposal)
  const published = await post(target, `/v1/forms/${spec.id}/versions`, { expectedBase: null, bundle })
  if (published.status !== 201) throw unexpected(`${spec.id}: POST /v1/forms/${spec.id}/versions`, published, 201)
  return { id: spec.id, account: proposal.snapshot.account.user, offers: proposal.bindings.operations, notes: proposal.notes, milliseconds: Date.now() - started }
}

/** Each form, one after another, every demo form unless told; throws on the first refusal, naming the form and the request. */
export async function publishDemoForms(target: PublishTarget, specs: readonly DemoFormSpec[] = DEMO_FORM_SPECS): Promise<PublishedForm[]> {
  const published: PublishedForm[] = []
  for (const spec of specs) published.push(await publishOne(target, spec))
  return published
}

/**
 * Waits until `GET /health` answers 200, asking every `pollMs`, and says
 * how long that took; throws when `deadlineMs` passes first.
 */
export async function waitForHealth(
  base: string,
  { deadlineMs = 30_000, pollMs = 100 }: { deadlineMs?: number; pollMs?: number } = {},
): Promise<number> {
  const started = Date.now()
  for (;;) {
    try {
      const response = await fetch(new URL('/health', base), { signal: AbortSignal.timeout(pollMs * 10) })
      await response.body?.cancel()
      if (response.status === 200) return Date.now() - started
    } catch {
      // Not listening yet.
    }
    if (Date.now() - started > deadlineMs) throw new Error(`The server at ${base} did not answer /health within ${String(deadlineMs)} ms.`)
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
}
