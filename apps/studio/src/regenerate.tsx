import type { ReactElement } from 'react'
import { describeReassigned } from '@formancy/data-core'
import type { DriftReport } from '@formancy/data-core'
import type { Regeneration } from '@formancy/data-server'
import type { AdminClient } from './api.js'
import { freshFields } from './carry.js'

/**
 * A regeneration (0030), as the Drift step shows it: the server's draft, or
 * its refusal. `fresh` is what the Presentation step offers a dropped label
 * to -- the fields whose column or lookup the regenerated version did not
 * have -- read from that exact version, not from whichever is newest now.
 */
export type Regenerated =
  | { ok: true; regeneration: Regeneration; fresh: string[] }
  | { ok: false; code: string; message: string; drift?: DriftReport }

export async function regenerateForm(client: AdminClient, formId: string): Promise<Regenerated> {
  const outcome = await client.regenerate(formId)
  if (!outcome.ok) return { ok: false, code: outcome.code, message: outcome.message, ...(outcome.drift === undefined ? {} : { drift: outcome.drift }) }
  const regeneration = outcome.value
  // The version regenerated from, for what it was bound to. Unread, nothing is offered as new: offering every field would
  // let a label land on one that already has its own.
  const from = await client.version(formId, regeneration.version)
  return { ok: true, regeneration, fresh: from.ok ? freshFields(from.value.bundle.bindings, regeneration.bindings) : [] }
}

/** What a refusal means for the person, beyond the server's sentence. */
const NEXT: Record<string, string> = {
  'published-before-0030': 'Choose its table again in the Choose step and generate it: publishing that makes the next version, which can be regenerated.',
  'cannot-generate': 'The report above says what changed. Nothing can be generated from the stored request until the database serves it again.',
}

/** One list of the regeneration's findings, or the sentence that says there are none: an empty kind is a finding too. */
function Findings({ id, heading, items, none }: { id: string; heading: string; items: readonly string[]; none: string }): ReactElement {
  return (
    <div className="finding">
      <h4 id={id}>{heading}</h4>
      {items.length === 0 ? (
        <p className="none">{none}</p>
      ) : (
        <ul aria-labelledby={id}>
          {items.map((item, index) => (
            // The server's order is the order to read them in, and two can say the same.
            <li key={index}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * What a regeneration carried and what it could not, in the server's words,
 * with the one way on: the draft into the Presentation step, where each
 * conflict that has a choice offers it. Nothing is published until the
 * person publishes it.
 */
export function RegenerationView({ regenerated, onContinue }: { regenerated: Regenerated; onContinue: (regeneration: Regeneration, fresh: string[]) => void }): ReactElement {
  if (!regenerated.ok) {
    const next = NEXT[regenerated.code]
    return (
      <div role="alert" className="problem-box">
        <p>{regenerated.message}</p>
        {next === undefined ? null : <p>{next}</p>}
      </div>
    )
  }
  const { regeneration, fresh } = regenerated
  return (
    <section className="regeneration" aria-labelledby="regeneration-heading">
      <h3 id="regeneration-heading">Regenerated from version {regeneration.version}</h3>
      <p role="status">
        Generated again from the database now, with your presentation carried by the column or lookup each choice was made
        for. Nothing is published until you publish it.
      </p>
      <Findings
        id="regeneration-conflicts"
        heading="Presentation not carried as it was"
        items={regeneration.conflicts.map((conflict) => conflict.message)}
        none="Every label, order and width was carried."
      />
      <Findings
        id="regeneration-lookups"
        heading="Lookups left out"
        items={regeneration.lookupsDropped.map((dropped) => `${dropped.foreignKey}: ${dropped.message}`)}
        none="Every lookup is still offered."
      />
      <Findings
        id="regeneration-keys"
        heading="Keys that now stand for something else"
        items={regeneration.keysReassigned.map(describeReassigned)}
        none="Every key stands for what it did."
      />
      <Findings id="regeneration-policy" heading="What the published policy no longer fits" items={regeneration.policyProblems} none="The published policy fits the regenerated form." />
      <p className="next">
        <button type="button" className="primary" onClick={() => onContinue(regeneration, fresh)}>
          Continue to presentation
        </button>
      </p>
    </section>
  )
}
