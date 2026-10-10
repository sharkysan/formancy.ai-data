import { useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import type { BuilderSession } from '@formancy/builder-core'
import { presentationOf, validatePolicy } from '@formancy/data-core'
import type { FormPolicy, ReassignedKey } from '@formancy/data-core'
import type { AdminClient, Bundle, Proposal, Published } from './api.js'
import { describeRef } from './choice.js'
import { useDocument } from './document.js'
import { useFocusAfterRender } from './focus.js'

/** The publish button's id, for the keyboard to return to. */
const PUBLISH = 'publish'
/** The conflict's rebase button's id, where the keyboard goes when publishing waits for it. */
const REBASE = 'publish-rebase'

/** What the studio knows about the newest published version, which is the base a publish names. */
type Base =
  | { state: 'reading' }
  /**
   * `rebased`: the person chose this base after a conflict, so publishing replaces somebody else's version.
   * `regenerated`: the version the draft was regenerated from, never re-read, so a publish since is a conflict.
   */
  | { state: 'known'; version: number | null; rebased?: true; regenerated?: true }
  /** The server could not serve it -- a version edited on disk, say. Publishing finds out which is current. */
  | { state: 'unknown'; message: string }

type Result =
  | { kind: 'published'; version: number }
  | { kind: 'conflict'; current: number | null; published: Published | null }
  | { kind: 'invalid'; message: string; problems: string[] }
  | { kind: 'failed'; message: string }

/**
 * What the publish button does, in its name: a version number only when the
 * studio knows it, and "over" when the base is somebody else's version the
 * person rebased onto, because that publish replaces it. None while a
 * conflict waits for the rebase, since the base it read is not the
 * published one any more.
 */
function publishLabel(base: Base, next: number, superseded: boolean): string {
  if (superseded || base.state !== 'known') return 'Publish'
  if (base.rebased === true && base.version !== null) return `Publish over version ${String(base.version)}`
  return `Publish version ${String(next)}`
}

/**
 * What the step knows of the published version, in one line: the base it
 * read, or -- after a conflict, until the person rebases -- the version that
 * is published now, which is somebody else's.
 */
function describeBase(formId: string, base: Base, next: number, superseded: { current: number | null } | null): string {
  if (superseded !== null) {
    return superseded.current === null
      ? `Which version of ${formId} is published changed while you worked. Publishing waits until you rebase on what is there.`
      : `Version ${String(superseded.current)} of ${formId} is published now, and it is somebody else's. Publishing waits until you rebase on it.`
  }
  if (base.state === 'reading') return `Reading which version of ${formId} is published…`
  if (base.state === 'unknown') return `The published version of ${formId} could not be read: ${base.message} Publishing will find out which version is current.`
  if (base.version === null) return `No version of ${formId} is published yet: this will be version 1.`
  if (base.regenerated === true) {
    return `Regenerated from version ${String(base.version)} of ${formId}. Publishing makes version ${String(next)}; if somebody has published since, the server says so and replaces nothing.`
  }
  if (base.rebased === true) {
    return `You rebased onto version ${String(base.version)}, which somebody else published. Publishing makes version ${String(next)} from your draft: their labels and policy are replaced, not merged.`
  }
  return `Version ${String(base.version)} of ${formId} is published. Publishing makes version ${String(next)}, which the runtime serves from then on.`
}

/** The newest version as the server serves it, said in one line. */
function describePublished(published: Published): string {
  const { bundle } = published
  const fields = bundle.form.model.fields.length
  return `Version ${String(published.version)}: “${typeof bundle.form.title === 'string' ? bundle.form.title : bundle.form.id}”, ${String(fields)} ${fields === 1 ? 'field' : 'fields'}, bound to ${describeRef(bundle.bindings.root)} on ${bundle.connection}.`
}

/**
 * Step 8: publish the form, its bindings, its policy and the snapshot they
 * were generated from as one bundle (0019), against the version this studio
 * last saw -- or, for a draft regenerated from a version, against that one.
 *
 * The bundle is format 2 (0030): the generated base, the request it came
 * from, and the presentation chosen over it, derived here by
 * `presentationOf` from the session's document. A draft holding anything
 * else -- builder-core accepts a required flag or a numeric span -- waits,
 * with each reason, rather than being refused at the last step.
 *
 * Publication is compare-and-swap (0013). The base is read when the step
 * opens and named in the request; if somebody published in between, the
 * server says 409 and which version is current, and the studio shows that
 * version and offers to publish over it -- a decision, never a retry. Until
 * the person rebases, the step says which version is published now and
 * publishing waits: the base it read is no longer the published one, and a
 * publish named after it would be refused again. A bundle the server refuses
 * (422) is shown with every reason it gives.
 */
export function PublishStep({
  client,
  connection,
  proposal,
  session,
  policy,
  stale,
  regeneratedFrom = null,
  undecided = [],
  confirmed = [],
  onPublished,
  onDrift,
}: {
  client: AdminClient
  connection: string
  proposal: Proposal
  session: BuilderSession
  policy: FormPolicy
  stale: boolean
  /** The version the draft was regenerated from, which is its base; `null` for a draft generated afresh. */
  regeneratedFrom?: number | null
  /** Keys whose grants were written for another column, not yet kept or removed in the Policy step, or given grants again since a removal. */
  undecided?: readonly string[]
  /** Keys kept there, confirmed with the publish: the server refuses grants on one it is not told of (0039). */
  confirmed?: readonly ReassignedKey[]
  onPublished: (formId: string, version: number) => void
  onDrift: () => void
}): ReactElement {
  const document = useDocument(session)
  const formId = document.id
  const [base, setBase] = useState<Base>(regeneratedFrom === null ? { state: 'reading' } : { state: 'known', version: regeneratedFrom, regenerated: true })
  const [result, setResult] = useState<Result | null>(null)
  const [pending, setPending] = useState(false)
  const focusAfter = useFocusAfterRender()

  useEffect(() => {
    if (regeneratedFrom !== null) return
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
  }, [client, formId, regeneratedFrom])

  // Derived from the document that will be sent, on every edit: the one source of truth for what the presentation is.
  const derived = useMemo(() => presentationOf(proposal.form, document, proposal.bindings), [proposal, document])
  const checked = validatePolicy(policy, proposal.bindings)
  const blockers = [
    checked.ok ? null : `The policy has ${String(checked.problems.length)} ${checked.problems.length === 1 ? 'problem' : 'problems'}: the Policy step lists ${checked.problems.length === 1 ? 'it' : 'them'}.`,
    stale ? 'The row filters changed since the form was generated: generate it again from the Policy step.' : null,
    undecided.length === 0
      ? null
      : `Grants for ${undecided.join(', ')} were written for another column or lookup: keep or remove them in the Policy step.`,
    ...(derived.ok ? [] : derived.problems.map((problem) => `Not presentation, which the server refuses: ${problem}`)),
  ].filter((blocker): blocker is string => blocker !== null)
  const expected = base.state === 'known' ? base.version : null
  const next = (expected ?? 0) + 1
  // Somebody else's version is current, and nothing is published over it until the person rebases on it.
  const superseded = result?.kind === 'conflict' ? result : null

  async function publish(): Promise<void> {
    // A second press while the first is on its way does nothing; the button
    // stays enabled, because a disabled one drops the keyboard's focus.
    if (pending) return
    if (!derived.ok) return
    const { form, bindings, snapshot, generation } = proposal
    const bundle: Bundle = { format: 2, connection, generation, base: form, presentation: derived.presentation, form: session.exportDocument(), bindings, policy, snapshot }
    setPending(true)
    setResult(null)
    const outcome = await client.publish(formId, expected, bundle, confirmed)
    if (outcome.ok) {
      setResult({ kind: 'published', version: outcome.value.version })
      // The next publish from here goes on top of this one.
      setBase({ state: 'known', version: outcome.value.version })
      onPublished(formId, outcome.value.version)
    } else if (outcome.status === 409) {
      const latest = await client.latest(formId)
      setResult({ kind: 'conflict', current: outcome.current ?? null, published: latest.ok ? latest.value : null })
      // The button pressed turns disabled until the rebase, which is what is left to do.
      focusAfter(REBASE)
    } else if (outcome.status === 422) {
      setResult({ kind: 'invalid', message: outcome.message, problems: outcome.problems ?? [] })
    } else {
      setResult({ kind: 'failed', message: outcome.message })
    }
    setPending(false)
  }

  function rebase(current: number | null): void {
    setBase(current === null ? { state: 'known', version: null } : { state: 'known', version: current, rebased: true })
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
      <p className="base">{describeBase(formId, base, next, superseded)}</p>
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
          disabled={base.state === 'reading' || superseded !== null || blockers.length > 0}
          aria-describedby={blockers.length === 0 ? undefined : 'publish-blockers'}
          onClick={() => void publish()}
        >
          {publishLabel(base, next, superseded !== null)}
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
          <button type="button" id={REBASE} className="button" onClick={() => rebase(result.current)}>
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
