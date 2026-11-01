import { GENERATED_SPEC_VERSION, SERVED_SPEC_VERSIONS } from '@formancy/data-core'
import type { FormSchema } from '@formancy/spec'
import { validateSchema } from '@formancy/spec/validate'

export type ServedSchema = { valid: true; schema: FormSchema } | { valid: false; problems: string[] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * A stored form or base as this server serves one: a document formancy's
 * validator accepts, in a spec version this server serves -- the one the
 * generator writes, or spec 3, which every release before 0118 wrote -- or
 * every reason it is not, each beginning with `label`.
 *
 * The version is this server's question as well as the validator's, because
 * the validator accepts every version its release speaks, and that grows
 * with the release: spec 4 is valid from `@formancy/spec` 0.4.0 on, and no
 * release of this server generated it, so a stored document that says it was
 * edited by hand. Another version is refused whole, since what the validator
 * would add is about a version this server does not serve. A construct of a
 * later version in a spec 3 document is refused with the same reason, by the
 * validator's code, rather than with its advice to move the document to that
 * version: a stored spec 3 version is served as it was stored, and moved
 * only by generating it again.
 */
export function servedSchema(label: 'form' | 'base', document: unknown): ServedSchema {
  const only = `and this server serves only spec ${JSON.stringify(GENERATED_SPEC_VERSION)}, the version it generates, and spec "3", which it generated before (0118)`
  const declared = isRecord(document) ? document['specVersion'] : undefined
  if (typeof declared === 'string' && !SERVED_SPEC_VERSIONS.includes(declared))
    return { valid: false, problems: [`${label}: is spec ${JSON.stringify(declared)}, ${only}`] }
  const checked = validateSchema(document)
  if (checked.valid) return checked
  return {
    valid: false,
    problems: checked.errors.map((error) =>
      error.code.startsWith('version.')
        ? `${label}: ${error.path} needs spec ${JSON.stringify(String(error.values['version']))}, ${only}`
        : `${label}: ${error.message}`,
    ),
  }
}
