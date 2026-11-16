import { formMenu, menuForm, rowsRequired } from '@formancy/data-core'
import type { FormMenu, MenuBundle, MenuForm, PolicyContext, PublishedTable } from '@formancy/data-core'
import type { FastifyBaseLogger, FastifyInstance, FastifyRequest } from 'fastify'
import type { ConfigurationStore } from '../config-store.js'
import { loadPublished } from '../published.js'

/** What the menu route borrows from the runtime plane. */
export interface MenuRouteSteps {
  store: ConfigurationStore
  /** The connections the deployment's allowlist has: the registry's `ids()`, which asks no database. */
  connections(): readonly string[]
  context(request: FastifyRequest): PolicyContext
}

/** One published form as served: its bundle as the menu reads one, and its entry in this person's menu. */
export interface ServedForm {
  bundle: MenuBundle
  form: MenuForm
}

/** What the menu answers when the store cannot list its forms: nothing it was told, no path. */
const STORE_UNAVAILABLE = { code: 'store-unavailable', message: 'The forms cannot be listed now.' } as const

/**
 * The newest version of `id` as this person's menu reads it, or `undefined`
 * when it is not served -- validated as every read is (0019), bound to a
 * connection the allowlist has, and read alone (`menuForm`). Whatever stops
 * one form -- a version that no longer validates, does not parse or cannot
 * be read, a connection the allowlist does not have, bindings a hand edit
 * left in a shape the check passes and the menu cannot read -- leaves that
 * form out, and the log says which and why; never a 500, which would let one
 * damaged file hide every form from everybody, and answer with what the
 * error said.
 */
async function entry(
  store: ConfigurationStore,
  allowed: readonly string[],
  id: string,
  context: PolicyContext,
  log: FastifyBaseLogger,
): Promise<ServedForm | undefined> {
  try {
    const loaded = await loadPublished(store, id, log)
    if (!loaded.ok) return undefined
    const { bundle } = loaded
    if (!allowed.includes(bundle.connection)) {
      log.error({ form: id, connection: bundle.connection }, 'a published form names a connection the allowlist does not have, and is not served')
      return undefined
    }
    // What the presentation says of the form's group (0143); a format-1 version has none, and gets the default as a silent one does.
    const group = bundle.format === 2 && bundle.presentation.group !== undefined ? { group: bundle.presentation.group } : {}
    const read: MenuBundle = {
      id,
      title: bundle.form.title,
      ...group,
      connection: bundle.connection,
      snapshot: bundle.snapshot,
      bindings: bundle.bindings,
      policy: bundle.policy,
    }
    return { bundle: read, form: menuForm(read, context) }
  } catch (error) {
    log.error({ form: id, error: (error as Error).message }, 'a published form cannot be read, and is not served')
    return undefined
  }
}

/**
 * Every published form as served, each with this person's menu entry
 * (`entry`), in the store's order, or `null` when the store cannot list its
 * forms -- which the log says. What the menu answers from, what a form's
 * lookups are matched against (0140), and what the create and save routes
 * find a together child of a record among (0155): one reading for all of
 * them, so a bundle the menu leaves out is no child anywhere.
 */
export async function servedForms(steps: MenuRouteSteps, request: FastifyRequest): Promise<ServedForm[] | null> {
  let ids: string[]
  try {
    ids = await steps.store.list()
  } catch (error) {
    request.log.error({ error: (error as Error).message }, 'the configuration store cannot list its forms')
    return null
  }
  const context = steps.context(request)
  const allowed = steps.connections()
  const forms: ServedForm[] = []
  for (const id of ids) {
    const read = await entry(steps.store, allowed, id, context, request.log)
    if (read !== undefined) forms.push(read)
  }
  return forms
}

/** Every published form as this person's menu reads it, or `null` when the store cannot list them (`servedForms`). */
export async function menuForms(steps: MenuRouteSteps, request: FastifyRequest): Promise<MenuForm[] | null> {
  return (await servedForms(steps, request))?.map((served) => served.form) ?? null
}

/**
 * The together children that require rows of `parent`'s records (0155),
 * among the served forms, whoever the person is: `rowsRequired` over every
 * bundle the menu reads. `null` when the store cannot list its forms, which
 * a caller refuses on, since it cannot tell.
 */
export function requiredOf(
  parent: PublishedTable,
  served: readonly ServedForm[] | null,
): Array<{ form: MenuBundle; field: string; min: number; max: number }> | null {
  return served === null
    ? null
    : rowsRequired(
        parent,
        served.map((entry) => entry.bundle),
      )
}

/**
 * Whether `GET /v1/forms/:id` may offer `create` of `parent` to this
 * person, as far as together children are concerned (0155): where none
 * requires rows of its records, as before; otherwise exactly where the
 * menu offers it -- the person can make the save that creates such a
 * record with its rows -- read from the menu's own answer, so the two
 * cannot disagree. A form the menu does not name, which this person may not
 * read, and a store that cannot list its forms offer none: the create
 * route would refuse a plain create of such a record, and the save would
 * find no child to make it with.
 */
export function createOffered(id: string, parent: PublishedTable, served: readonly ServedForm[] | null): boolean {
  const required = requiredOf(parent, served)
  if (required === null || served === null) return false
  if (required.length === 0) return true
  const entry = formMenu(served.map((form) => form.form)).forms.find((form) => form.id === id)
  return entry?.operations.includes('create') ?? false
}

/**
 * `GET /v1/forms` (0045): the published forms this person may read, in
 * codepoint order of their ids, each with its title, the group it is
 * listed under (0143), the operations the policy grants them of what it
 * offers as published, and the children a page may show under one of its
 * records -- a together child with what this person may do with its rows
 * in a save (0155) -- and nothing about any other form, so the answer is
 * the same to the byte whatever else is published.
 *
 * Every request reads and validates every published form's newest version,
 * and asks the policy of each (0019, 0022): nothing is cached. It asks no
 * database. Opening a form asks what the database as it is now allows
 * (`GET /v1/forms/:id`, 0041); the menu, over every form, would otherwise
 * be a statement per form, and one database out of reach would hide forms
 * on every other. A store that cannot list its forms is a 500 that says
 * only that. The audit names the operation `form-list`, and no form.
 */
export function registerMenuRoute(app: FastifyInstance, steps: MenuRouteSteps): void {
  app.get('/v1/forms', async (request, reply) => {
    const forms = await menuForms(steps, request)
    if (forms === null) return reply.code(500).send(STORE_UNAVAILABLE)
    return formMenu(forms) satisfies FormMenu
  })
}
