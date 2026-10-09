import type { FormSchema } from '@formancy/spec'
import type { LookupRow } from './lookup/types.js'
import type { PolicyOperation } from './policy/types.js'
import type { FieldError } from './records/plan-types.js'

/*
 * The runtime plane's replies that have no type of their own elsewhere in the
 * core, declared once so that the server that sends them and the client that
 * reads them compile against the same shape (0029). A record is `FormRecord`
 * and a search is `LookupResult`, which the planner and the adapters already
 * return; these are the three the server used to build by hand.
 *
 * Shapes only. Nothing here checks a reply: the client reads what arrives as
 * `unknown` and the server's handlers are annotated with these, so a change on
 * either side is a type error on the other before it is a blank form.
 */

/**
 * `GET /v1/forms/:id`: the published document, what this person may do with
 * it, and which of its fields they may see.
 *
 * `operations` is never empty: a person the policy grants nothing is refused
 * with 403 rather than handed a form they cannot use. `readable` is the field
 * keys the policy lets them read, in the bindings' order; a field outside it
 * arrives in no record.
 */
export interface PublishedForm {
  form: FormSchema
  operations: PolicyOperation[]
  readable: string[]
}

/**
 * Every runtime refusal's body: a stable code for a program, a sentence a
 * person can be shown, and the fields it concerns when it concerns fields.
 *
 * The sentence never echoes a submitted value (0011). `fieldErrors` is present
 * on `422 invalid-values`, and on a constraint failure only when the engine
 * named a column the form binds; a refusal without it is about the record or
 * the request as a whole.
 */
export interface RuntimeRefusal {
  code: string
  message: string
  fieldErrors?: FieldError[]
}

/**
 * `POST /v1/forms/:id/lookups/:source/resolve`: the labels of the tokens asked
 * about that this person may see. A token they may not see is absent, not an
 * error, so the reply cannot be used to learn that another tenant's row exists
 * (0012).
 */
export interface ResolvedLookup {
  rows: LookupRow[]
}
