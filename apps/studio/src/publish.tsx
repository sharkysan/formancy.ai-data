import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import type { BuilderSession } from '@formancy/builder-core'
import { validatePolicy } from '@formancy/data-core'
import type { FormPolicy } from '@formancy/data-core'
import type { AdminClient, Bundle, Proposal, Published } from './api.js'
import { describeRef } from './choice.js'
import { useDocument } from './document.js'
import { useFocusAfterRender } from './focus.js'

/** The publish button's id, for the keyboard to return to. */
const PUBLISH = 'publish'

/** What the studio knows about the newest published version, which is the base a publish names. */
type Base =
  | { state: 'reading' }
  | { state: 'known'; version: number | null }
  /** The server could not serve it -- a version edited on disk, say. Publishing finds out which is current. */
  | { state: 'unknown'; message: string }

type Result =
  | { kind: 'published'; version: number }
  | { kind: 'conflict'; current: number | null; published: Published | null }
  | { kind: 'invalid'; message: string; problems: string[] }
  | { kind: 'failed'; message: string }

/** The newest version as the server serves it, said in one line. */
function describePublished(published: Published): string {
  const { bundle } = published
  const fields = bundle.form.model.fields.length
  return `Version ${String(published.version)}: “${typeof bundle.form.title === 'string' ? bundle.form.title : bundle.form.id}”, ${String(fields)} ${fields === 1 ? 'field' : 'fields'}, bound to ${describeRef(bundle.bindings.root)} on ${bundle.connection}.`
}

/**
 * Step 8: publish the form, its bindings, its policy and the snapshot they
 * were generated from as one bundle (0019), against the version this studio
 * last saw.
 *
 * Publication is compare-and-swap (0013). The base is read when the step
 * opens and named in the request; if somebody published in between, the
 * server says 409 and which version is current, and the studio shows that
 * version and offers to publish over it -- a decision, never a retry. A
 * bundle the server refuses (422) is shown with every reason it gives.
 */
export function PublishStep({
  client,
  connection,
  proposal,
  session,
  policy,
  stale,
  onPublished,
  onDrift,
}: {
  client: AdminClient
  connection: string
  proposal: Proposal
  session: BuilderSession
  policy: FormPolicy
  stale: boolean
  onPublished: (formId: string) => void
  onDrift: () => void
}): ReactElement {
  const document = useDocument(session)
  const formId = document.id
  const [base, setBase] = useState<Base>({ state: 'reading' })
  const [result, setResult] = useState<Result | null>(null)
  const [pending, setPending] = useState(false)
  const focusAfter = useFocusAfterRender()

  useEffect(() => {
    let current = true
    void client.latest(formId).then((latest) => {
      if (!current) return
      if (latest.ok) setBase({ state: 'known', version: latest.value.version })
      else if (latest.status === 404) setBase({ state: 'known', version: null })
      else setBase({ state: 'unknown', message: latest.message })
    })
    return () => {
      current = false
    }
  }, [client, formId])

  const checked = validatePolicy(policy, proposal.bindings)
  const blockers = [
    checked.ok ? null : `The policy has ${String(checked.problems.length)} ${checked.problems.length === 1 ? 'problem' : 'problems'}: the Policy step lists ${checked.problems.length === 1 ? 'it' : 'them'}.`,
    stale ? 'The row filters changed since the form was generated: generate it again from the Policy step.' : null,
  ].filter((blocker): blocker is string => blocker !== null)
  const expected = base.state === 'known' ? base.version : null
  const next = (expected ?? 0) + 1

  async function publish(): Promise<void> {
    // A second press while the first is on its way does nothing; the button
    // stays enabled, because a disabled one drops the keyboard's focus.
    if (pending) return
    const bundle: Bundle = { format: 1, connection, form: session.exportDocument(), bindings: proposal.bindings, policy, snapshot: proposal.snapshot }
    setPending(true)
    setResult(null)
    const outcome = await client.publish(formId, expected, bundle)
    if (outcome.ok) {
      setResult({ kind: 'published', version: outcome.value.version })
      // The next publish from here goes on top of this one.
      setBase({ state: 'known', version: outcome.value.version })
      onPublished(formId)
    } else if (outcome.status === 409) {
      const latest = await client.latest(formId)
      setResult({ kind: 'conflict', current: outcome.current ?? null, published: latest.ok ? latest.value : null })
    } else if (outcome.status === 422) {
      setResult({ kind: 'invalid', message: outcome.message, problems: outcome.problems ?? [] })
    } else {
      setResult({ kind: 'failed', message: outcome.message })
    }
    setPending(false)
  }

  function rebase(current: number | null): void {
    setBase({ state: 'known', version: current })
    setResult(null)
    // The conflict closes, and the button pressed with it; what is left to
    // do is publish, on top of the version just rebased onto.
    focusAfter(PUBLISH)
  }

  return (
    <>
      <p className="lede">
        One bundle: the form as the presentation step left it, its bindings to {describeRef(proposal.bindings.root)} on{' '}
        <code>{connection}</code>, the policy, and the snapshot they were generated from. The server checks all of it again
        before it writes anything, and keeps every version it has published.
      </p>
      <p className="base">
        {base.state === 'reading'
          ? `Reading which version of ${formId} is published…`
          : base.state === 'unknown'
            ? `The published version of ${formId} could not be read: ${base.message} Publishing will find out which version is current.`
            : base.version === null
              ? `No version of ${formId} is published yet: this will be version 1.`
              : `Version ${String(base.version)} of ${formId} is published. Publishing makes version ${String(next)}, which the runtime serves from then on.`}
      </p>
      {blockers.length === 0 ? null : (
        <div className="notice" role="note" id="publish-blockers">
          <p>Not yet:</p>
          <ul>
            {blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="next">
        <button
          type="button"
          id={PUBLISH}
          className="primary"
          disabled={base.state === 'reading' || blockers.length > 0}
          aria-describedby={blockers.length === 0 ? undefined : 'publish-blockers'}
          onClick={() => void publish()}
        >
          Publish version {next}
        </button>
      </p>
      {result === null ? null : result.kind === 'published' ? (
        <div role="status" className="done">
          <p>Published version {result.version} of {formId}.</p>
          <button type="button" className="button" onClick={onDrift}>
            Check its drift
          </button>
        </div>
      ) : result.kind === 'conflict' ? (
        <div role="alert" className="problem-box">
          <p>
            Somebody published {result.current === null ? 'first' : `version ${String(result.current)}`} while you worked.
            Yours was not published, and theirs is untouched.
          </p>
          {result.published === null ? null : <p>{describePublished(result.published)}</p>}
          <button type="button" className="button" onClick={() => rebase(result.current)}>
            Rebase on {result.current === null ? 'what is there' : `version ${String(result.current)}`}
          </button>
        </div>
      ) : result.kind === 'invalid' ? (
        <div role="alert" className="problem-box">
          <p>The server refused the bundle: {result.message}</p>
          {result.problems.length === 0 ? null : (
            <ul>
              {result.problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <p role="alert" className="problem-box">
          {result.message}
        </p>
      )}
    </>
  )
}
