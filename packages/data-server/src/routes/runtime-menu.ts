import { formMenu, menuForm } from '@formancy/data-core'
import type { FormMenu, MenuForm, PolicyContext } from '@formancy/data-core'
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
): Promise<MenuForm | undefined> {
  try {
    const loaded = await loadPublished(store, id, log)
    if (!loaded.ok) return undefined
    const { bundle } = loaded
    if (!allowed.includes(bundle.connection)) {
      log.error({ form: id, connection: bundle.connection }, 'a published form names a connection the allowlist does not have, and is not served')
      return undefined
    }
    return menuForm(
      { id, title: bundle.form.title, connection: bundle.connection, snapshot: bundle.snapshot, bindings: bundle.bindings, policy: bundle.policy },
      context,
    )
  } catch (error) {
    log.error({ form: id, error: (error as Error).message }, 'a published form cannot be read, and is not served')
    return undefined
  }
}

/**
 * `GET /v1/forms` (0045): the published forms this person may read, in
 * codepoint order of their ids, each with its title, the operations the
 * policy grants them of what it offers as published, and the children a
 * page may show under one of its records -- and nothing about any other
 * form, so the answer is the same to the byte whatever else is published.
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
    let ids: string[]
    try {
      ids = await steps.store.list()
    } catch (error) {
      request.log.error({ error: (error as Error).message }, 'the configuration store cannot list its forms')
      return reply.code(500).send(STORE_UNAVAILABLE)
    }
    const context = steps.context(request)
    const allowed = steps.connections()
    const forms: MenuForm[] = []
    for (const id of ids) {
      const read = await entry(steps.store, allowed, id, context, request.log)
      if (read !== undefined) forms.push(read)
    }
    return formMenu(forms) satisfies FormMenu
  })
}
