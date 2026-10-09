import type { FastifyBaseLogger } from 'fastify'
import { validateBundle } from './bundle.js'
import type { PublishedBundle } from './bundle.js'
import type { ConfigurationStore } from './config-store.js'

/** A form id is a configuration id: lower case, so it means one thing on every filesystem (0013). */
export const FORM_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/

export type Published =
  | { ok: true; version: number; bundle: PublishedBundle }
  | { ok: false; status: 404; code: 'unknown-form'; message: string }
  | { ok: false; status: 500; code: 'corrupt-bundle'; message: string }

/**
 * The newest published version of a form, validated again on the way out of
 * the store (0019). One function for both planes, because "a hand-edited
 * version is never served" is one decision and two copies of it could drift.
 *
 * The problems go to the operator's log; the caller learns only that the
 * version is not served.
 */
export async function loadPublished(store: ConfigurationStore, id: string, log: FastifyBaseLogger): Promise<Published> {
  const unknown = { ok: false, status: 404, code: 'unknown-form', message: `No form is called ${id}.` } as const
  if (!FORM_ID.test(id)) return unknown
  const version = await store.latest(id)
  if (version === null) return unknown
  const checked = validateBundle(await store.read(id, version))
  if (!checked.ok) {
    log.error({ form: id, version, problems: checked.problems }, 'a published bundle failed validation')
    return { ok: false, status: 500, code: 'corrupt-bundle', message: `Version ${String(version)} of ${id} no longer validates and is not served.` }
  }
  return { ok: true, version, bundle: checked.bundle }
}
