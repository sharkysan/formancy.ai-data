import { GENERATED_SPEC_VERSION } from '@formancy/data-core'
import type { FormSchema } from '@formancy/spec'
import { validateSchema } from '@formancy/spec/validate'

export type ServedSchema = { valid: true; schema: FormSchema } | { valid: false; problems: string[] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * A stored form or base as this server serves one: a document formancy's
 * validator accepts, in the spec version the generator writes (0042), or
 * every reason it is not, each beginning with `label`.
 *
 * The version is this server's question as well as the validator's, because
 * the validator accepts every version its release speaks, and that grows
 * with the release: at `@formancy/spec` 0.4.0 a spec 4 document is valid,
 * and a host page whose renderer is at 0.3.0 refuses it outright. Another
 * version is refused whole, since what the validator would add is about a
 * version this server does not serve. A construct of a later version in a
 * document that says the generator's is refused with the same reason, by
 * the validator's code, rather than with its advice to move the document to
 * that version, which this server would then refuse.
 */
export function servedSchema(label: 'form' | 'base', document: unknown): ServedSchema {
  const only = `and this server publishes and serves only spec ${JSON.stringify(GENERATED_SPEC_VERSION)}, the version it generates (0042)`
  const declared = isRecord(document) ? document['specVersion'] : undefined
  if (typeof declared === 'string' && declared !== GENERATED_SPEC_VERSION) return { valid: false, problems: [`${label}: is spec ${JSON.stringify(declared)}, ${only}`] }
  const checked = validateSchema(document)
  if (checked.valid) return checked
  return {
    valid: false,
    problems: checked.errors.map((error) =>
      error.code.startsWith('version.') ? `${label}: ${error.path} needs spec ${JSON.stringify(String(error.values['version']))}, ${only}` : `${label}: ${error.message}`,
    ),
  }
}
