import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { createBuilderSession } from '@formancy/builder-core'
import type { BuilderSession } from '@formancy/builder-core'
import type { FormPolicy, MetadataSnapshot } from '@formancy/data-core'
import type { Failure, Proposal, ProposalRequest } from './api.js'
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

/** A proposal, the request that produced it, and the session its presentation is edited in. */
interface Generated {
  request: ProposalRequest
  proposal: Proposal
  session: BuilderSession
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
  const [choice, setChoice] = useState<Choice | null>(null)
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

  function discoveredNow(connection: string, snapshot: MetadataSnapshot): void {
    if (discovered?.connection !== connection) {
      // Another database: nothing chosen for the last one applies to it.
      setChoice(null)
      setGenerated(null)
      setPolicy(EMPTY_POLICY)
    }
    setDiscovered({ connection, snapshot })
  }

  function chose(next: Choice): void {
    if (choice !== null && !sameRef(choice.root, next.root)) {
      // Another root: the form, its pins and its policy were about the old one.
      setGenerated(null)
      setPolicy(EMPTY_POLICY)
    }
    setChoice(next)
  }

  async function generate(request: ProposalRequest): Promise<Failure | null> {
    const outcome = await client.propose(request)
    if (!outcome.ok) return outcome
    setGenerated({ request, proposal: outcome.value, session: createBuilderSession(outcome.value.form) })
    setPolicy((previous) => withRequiredLookupPins(previous, outcome.value.bindings))
    setCurrent('generate')
    return null
  }

  const title = STEPS.find((entry) => entry.id === current)?.title ?? ''
  const stale = generated !== null && pinsDiffer(generated.request.pinned, policy.rowFilters)

  function body(): ReactElement | null {
    switch (current) {
      case 'connect':
        return <ConnectStep client={client} connections={connections} discovered={discovered} onDiscovered={discoveredNow} onChoose={() => setCurrent('choose')} />
      case 'drift':
        return <DriftStep client={client} formId={publishedId ?? generated?.request.formId ?? ''} />
      case 'choose':
        return discovered === null ? null : (
          <ChooseStep
            snapshot={discovered.snapshot}
            connection={discovered.connection}
            choice={choice}
            onChoice={chose}
            rowFilters={policy.rowFilters}
            onRowFilters={(rowFilters) => setPolicy((previous) => ({ ...previous, rowFilters }))}
            generated={generated !== null}
            onGenerate={generate}
          />
        )
    }
    if (generated === null) return null
    const { proposal, session, request } = generated
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
              if (choice === null) return 'nothing is chosen to generate from.'
              const failure = await generate(proposalFor(request.connection, choice, policy.rowFilters))
              return failure?.message ?? null
            }}
          />
        )
      case 'presentation':
        return <PresentationStep session={session} />
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
            onPublished={(formId) => setPublishedId(formId)}
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
