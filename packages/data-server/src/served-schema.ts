import { GENERATED_SPEC_VERSION, SERVED_SPEC_VERSIONS } from '@formancy/data-core'
import type { FormSchema, SchemaError } from '@formancy/spec'
import { validateSchema } from '@formancy/spec/validate'

export type ServedSchema = { valid: true; schema: FormSchema } | { valid: false; problems: string[] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** What every refusal of a version names instead: the versions this server serves (0118). */
const ONLY = `and this server serves only spec ${JSON.stringify(GENERATED_SPEC_VERSION)}, the version it generates, and spec "3", which it generated before (0118)`

/**
 * Why a stored document says a spec version this server does not serve, in
 * this server's words, or `null`: a version it serves, or none at all,
 * which is the validator's to name.
 */
export function unservedVersion(document: unknown): string | null {
  const declared = isRecord(document) ? document['specVersion'] : undefined
  return typeof declared === 'string' && !SERVED_SPEC_VERSIONS.includes(declared) ? `is spec ${JSON.stringify(declared)}, ${ONLY}` : null
}

/**
 * The validator's `error` in this server's words where it is a later
 * version's construct -- a `version.*` code -- or `null` for any other,
 * whose own sentence stands.
 */
export function laterConstruct(error: SchemaError): string | null {
  return error.code.startsWith('version.') ? `needs spec ${JSON.stringify(String(error.values['version']))}, ${ONLY}` : null
}

/**
 * A stored form or base as this server serves one: a document formancy's
 * validator accepts, in a spec version this server serves -- the one the
 * generator writes, or spec 3, which every release before 0118 wrote -- or
 * every reason it is not, each beginning with `label`. An action's dialog
 * is held to the same versions, through the same two functions
 * (`bundle-format2.ts`).
 *
 * The version is this server's question as well as the validator's, because
 * the validator accepts every version its release speaks, and that grows
 * with the release: spec 4 is valid from `@formancy/spec` 0.4.0 on and spec 6
 * from 0.14.0 on, and no release of this server generated either, so a
 * stored document that says one was edited by hand. Another version is
 * refused whole, since what the validator would add is about a version this
 * server does not serve. A construct of a later version in a spec 3 or
 * spec 5 document -- spec 4's `step`, spec 6's `precision` -- is refused
 * with the same reason, by the validator's code, rather than with its
 * advice to move the document to that version: a stored version is served
 * in the spec it was stored in, and moved only by generating it again.
 */
export function servedSchema(label: 'form' | 'base', document: unknown): ServedSchema {
  const unserved = unservedVersion(document)
  if (unserved !== null) return { valid: false, problems: [`${label}: ${unserved}`] }
  const checked = validateSchema(document)
  if (checked.valid) return checked
  return {
    valid: false,
    problems: checked.errors.map((error) => {
      const later = laterConstruct(error)
      return later === null ? `${label}: ${error.message}` : `${label}: ${error.path} ${later}`
    }),
  }
}
