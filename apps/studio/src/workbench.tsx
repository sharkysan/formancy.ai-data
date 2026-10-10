import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { createBuilderSession } from '@formancy/builder-core'
import type { BuilderSession } from '@formancy/builder-core'
import type { FormPolicy, MetadataSnapshot } from '@formancy/data-core'
import type { Regeneration } from '@formancy/data-server'
import type { Failure, Proposal, ProposalRequest } from './api.js'
import { asked, carriedAgain, carryDraft, decide } from './carry.js'
import type { Carried } from './carry.js'
import { ChooseStep } from './choose.js'
import type { Choice } from './choice.js'
import { proposalFor, sameRef } from './choice.js'
import { ConnectStep } from './connect.js'
import { DriftStep } from './drift.js'
import { GenerateStep } from './generate.js'
import { IdentityList, TOKEN_KEPT } from './identity.js'
import { PolicyStep } from './policy.js'
import { EMPTY_POLICY, pinsDiffer, withRequiredLookupPins } from './policy-model.js'
import { PresentationStep } from './presentation.js'
import { PreviewStep } from './preview.js'
import { PublishStep } from './publish.js'
import type { SignedIn } from './sign-in.js'

type StepId = 'connect' | 'choose' | 'generate' | 'policy' | 'presentation' | 'preview' | 'publish' | 'drift'

/** The journey of plan section 3, in its order. Signing in is the step before these. */
const STEPS: ReadonlyArray<{ id: StepId; title: string }> = [
  { id: 'connect', title: 'Connect' },
  { id: 'choose', title: 'Choose' },
  { id: 'generate', title: 'Generate' },
  { id: 'policy', title: 'Policy' },
  { id: 'presentation', title: 'Presentation' },
  { id: 'preview', title: 'Preview' },
  { id: 'publish', title: 'Publish' },
  { id: 'drift', title: 'Drift' },
]

interface Discovered {
  connection: string
  snapshot: MetadataSnapshot
}

/** A choice, and the connection it was made on: on another database it names nothing. */
interface Chosen {
  connection: string
  choice: Choice
}

/**
 * A proposal, the request that produced it, and the session its presentation
 * is edited in; and, for a draft carried from another (0030), what came
 * across and what did not.
 */
interface Generated {
  request: ProposalRequest
  proposal: Proposal
  session: BuilderSession
  carried: Carried | null
}

/**
 * The signed-in studio: the steps on one side, the step on the other.
 *
 * A step that cannot work yet is listed and disabled, with what it waits for,
 * rather than shown and failing. Everything the steps share lives here: what
 * was discovered, what was chosen, the policy, and the generated form with the
 * session its presentation is edited in -- so moving between steps loses
 * nothing.
 */
export function Workbench({ signedIn, onSignOut }: { signedIn: SignedIn; onSignOut: () => void }): ReactElement {
  const { client, identity, connections } = signedIn
  const [current, setCurrent] = useState<StepId>('connect')
  const [discovered, setDiscovered] = useState<Discovered | null>(null)
  const [chosen, setChosen] = useState<Chosen | null>(null)
  const [policy, setPolicy] = useState<FormPolicy>(EMPTY_POLICY)
  const [generated, setGenerated] = useState<Generated | null>(null)
  const [publishedId, setPublishedId] = useState<string | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)

  // A step that changes takes focus to its heading, so a keyboard or screen
  // reader user starts where the new content starts rather than on a button
  // in the list.
  useEffect(() => {
    heading.current?.focus()
  }, [current])

  const waiting: Record<StepId, string | null> = {
    connect: null,
    choose: discovered === null ? 'after a connection is discovered' : null,
    generate: generated === null ? 'after a form is generated' : null,
    policy: generated === null ? 'after a form is generated' : null,
    presentation: generated === null ? 'after a form is generated' : null,
    preview: generated === null ? 'after a form is generated' : null,
    publish: generated === null ? 'after a form is generated' : null,
    drift: null,
  }

  function discovering(): void {
    // A discovery on its way: until it answers, nothing offers to choose a
    // root -- neither Connect's button nor the Steps list -- or Choose would
    // open on the last connection and switch under the operator, emptying
    // what they typed, when this one answered. A refusal leaves nothing.
    setDiscovered(null)
  }

  function discoveredNow(connection: string, snapshot: MetadataSnapshot): void {
    // Discovering is looking, and the Connect step invites comparing what
    // each connection can see. What was chosen, generated and granted on the
    // last database stays until a root is chosen on this one.
    setDiscovered({ connection, snapshot })
  }

  function chose(connection: string, next: Choice): void {
    if (chosen !== null && (chosen.connection !== connection || !sameRef(chosen.choice.root, next.root))) {
      // Another root, or a root on another database: the form, its pins and
      // its policy were about the old one. The Choose step says so on the
      // root, before it is chosen.
      setGenerated(null)
      setPolicy(EMPTY_POLICY)
    }
    setChosen({ connection, choice: next })
  }

  async function generate(request: ProposalRequest): Promise<Failure | null> {
    const outcome = await client.propose(request)
    if (!outcome.ok) return outcome
    setGenerated({ request, proposal: outcome.value, session: createBuilderSession(outcome.value.form), carried: null })
    setPolicy((previous) => withRequiredLookupPins(previous, outcome.value.bindings))
    setCurrent('generate')
    return null
  }

  /**
   * The Policy step's "Generate again": a new proposal with the draft's
   * presentation carried onto it, as a regeneration carries a published one.
   * A draft regenerated from a version keeps that version as its base, and
   * its reassigned keys, decided or not.
   */
  async function generateAgain(previous: Generated, request: ProposalRequest): Promise<string | null> {
    const outcome = await client.propose(request)
    if (!outcome.ok) return outcome.message
    const carried = carryDraft({ proposal: previous.proposal, edited: previous.session.exportDocument() }, outcome.value)
    if (!carried.ok) return carried.message
    setGenerated({
      request,
      proposal: outcome.value,
      session: createBuilderSession(carried.form),
      carried: carriedAgain(previous.carried, previous.proposal.bindings, carried, outcome.value.bindings),
    })
    setPolicy((current) => withRequiredLookupPins(current, outcome.value.bindings))
    setCurrent('generate')
    return null
  }

  /**
   * A regeneration taken up as the draft: its base as the proposal, the
   * carried form in a new session, the published policy, and the choice and
   * discovery rebuilt from its request and snapshot, so the Choose step and
   * "Generate again" work on it as on any draft.
   */
  function takeUp(regeneration: Regeneration, fresh: string[]): void {
    const { generation, snapshot, base, bindings, notes, form, version } = regeneration
    const { connection, root, formId, title, lookups } = generation
    const versionColumn = generation.versionColumn ?? null
    const request: ProposalRequest = { connection, root, formId, title, lookups, pinned: generation.pinned ?? [], ...(versionColumn === null ? {} : { versionColumn }) }
    setDiscovered({ connection, snapshot })
    setChosen({ connection, choice: { root, formId, title, lookups, versionColumn } })
    setPolicy(withRequiredLookupPins(regeneration.policy, bindings))
    setGenerated({
      request,
      proposal: { form: base, bindings, notes, snapshot, generation },
      session: createBuilderSession(form),
      carried: { from: `version ${String(version)}`, version, conflicts: regeneration.conflicts, fresh, undecided: regeneration.keysReassigned, kept: [], removed: [] },
    })
    setPublishedId(formId)
    setCurrent('presentation')
  }

  /** A reassigned key kept or removed: one fewer for the Publish step to wait on; kept, one more for it to confirm. */
  function decided(key: string, decision: 'keep' | 'remove'): void {
    setGenerated((previous) => (previous === null || previous.carried === null ? previous : { ...previous, carried: decide(previous.carried, key, decision) }))
  }

  /** Published: the draft's base is now whatever is newest, read when the Publish step opens again. */
  function published(formId: string): void {
    setPublishedId(formId)
    setGenerated((previous) => (previous === null || previous.carried === null ? previous : { ...previous, carried: { ...previous.carried, version: null } }))
  }

  const title = STEPS.find((entry) => entry.id === current)?.title ?? ''
  const stale = generated !== null && pinsDiffer(generated.request.pinned, policy.rowFilters)

  function body(): ReactElement | null {
    switch (current) {
      case 'connect':
        return (
          <ConnectStep
            client={client}
            connections={connections}
            discovered={discovered}
            onDiscovering={discovering}
            onDiscovered={discoveredNow}
            onChoose={() => setCurrent('choose')}
          />
        )
      case 'drift':
        return <DriftStep client={client} formId={publishedId ?? generated?.request.formId ?? ''} onRegenerated={takeUp} />
      case 'choose':
        return discovered === null ? null : (
          <ChooseStep
            snapshot={discovered.snapshot}
            connection={discovered.connection}
            choice={chosen?.connection === discovered.connection ? chosen.choice : null}
            onChoice={(next) => chose(discovered.connection, next)}
            rowFilters={policy.rowFilters}
            onRowFilters={(rowFilters) => setPolicy((previous) => ({ ...previous, rowFilters }))}
            generated={generated?.request ?? null}
            onGenerate={generate}
          />
        )
    }
    if (generated === null) return null
    const { proposal, session, request, carried } = generated
    const open = asked(carried, policy)
    switch (current) {
      case 'generate':
        return <GenerateStep proposal={proposal} onNext={() => setCurrent('policy')} />
      case 'policy':
        return (
          <PolicyStep
            bindings={proposal.bindings}
            snapshot={proposal.snapshot}
            session={session}
            policy={policy}
            onPolicy={setPolicy}
            stale={stale}
            onRegenerate={async () => {
              if (chosen === null) return 'nothing is chosen to generate from.'
              return generateAgain(generated, proposalFor(request.connection, chosen.choice, policy.rowFilters))
            }}
            reassigned={open}
            onDecided={decided}
          />
        )
      case 'presentation':
        return <PresentationStep session={session} carried={carried} />
      case 'preview':
        return <PreviewStep session={session} bindings={proposal.bindings} />
      case 'publish':
        return (
          <PublishStep
            client={client}
            connection={request.connection}
            proposal={proposal}
            session={session}
            policy={policy}
            stale={stale}
            regeneratedFrom={carried?.version ?? null}
            undecided={open.map((entry) => entry.field)}
            confirmed={carried?.kept ?? []}
            onPublished={published}
            onDrift={() => setCurrent('drift')}
          />
        )
    }
    return null
  }

  return (
    <div className="studio">
      <a className="skip" href="#step">
        Skip to the step
      </a>
      <header className="studio-side">
        <h1 className="brand">Formancy Data Studio</h1>
        <section className="signed-in" aria-labelledby="signed-in-heading">
          <h2 id="signed-in-heading">Signed in</h2>
          <IdentityList identity={identity} />
          <p className="hint">{TOKEN_KEPT}</p>
          <button type="button" className="quiet" onClick={onSignOut}>
            Sign out
          </button>
        </section>
        <nav aria-label="Steps">
          <ol className="steps">
            {STEPS.map((entry, index) => {
              const reason = waiting[entry.id]
              return (
                <li key={entry.id}>
                  <button
                    type="button"
                    aria-current={entry.id === current ? 'step' : undefined}
                    disabled={reason !== null}
                    aria-describedby={reason === null ? undefined : `waits-${entry.id}`}
                    onClick={() => setCurrent(entry.id)}
                  >
                    {index + 1}. {entry.title}
                  </button>
                  {reason === null ? null : (
                    <span id={`waits-${entry.id}`} className="waits">
                      {reason}
                    </span>
                  )}
                </li>
              )
            })}
          </ol>
        </nav>
      </header>
      <main id="step" tabIndex={-1} aria-labelledby="step-heading" className="step">
        <h2 id="step-heading" ref={heading} tabIndex={-1}>
          {title}
        </h2>
        {body()}
      </main>
    </div>
  )
}
