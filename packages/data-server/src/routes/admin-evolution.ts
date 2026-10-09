import { buildLookupConfig, diffSnapshots, generateForm, reassignedKeys, rebasePresentation } from '@formancy/data-core'
import type {
  DriftReport,
  FormBindings,
  FormPolicy,
  GeneratedForm,
  GenerationNote,
  GenerationRequest,
  LookupChoice,
  MetadataSnapshot,
  PresentationConflict,
  PresentationOverrides,
  ReassignedKey,
} from '@formancy/data-core'
import type { FormSchema } from '@formancy/spec'
import { validateSchema } from '@formancy/spec/validate'
import type { FastifyInstance, FastifyReply } from 'fastify'
import { policyProblems } from '../bundle.js'
import type { BundleV2 } from '../bundle.js'
import type { ConfigurationStore } from '../config-store.js'
import { FORM_ID, loadPublished, loadVersion } from '../published.js'
import type { Discover, Refuse } from './admin.js'

/**
 * What `POST /v1/forms/:id/regenerations` answers: the newest version
 * regenerated from the database as it is now, with its presentation carried
 * (0030). Nothing is written; this is a draft to review and publish.
 */
export interface Regeneration {
  /** The version regenerated from; publish with it as `expectedBase`. */
  version: number
  /** `diffSnapshots(published snapshot, now, published bindings, published policy)`. */
  drift: DriftReport
  /** The request as used: lookups the database no longer allows are left out. */
  generation: GenerationRequest
  base: FormSchema
  bindings: FormBindings
  notes: GenerationNote[]
  snapshot: MetadataSnapshot
  /** The published policy, unchanged. */
  policy: FormPolicy
  /** What that policy does not fit in the new bindings and snapshot. */
  policyProblems: string[]
  /** The published presentation, carried to the new base. */
  presentation: PresentationOverrides
  /** The new base with it applied. */
  form: FormSchema
  conflicts: PresentationConflict[]
  /** Lookups the runtime would refuse now, each with the sentence that refuses it. */
  lookupsDropped: Array<{ foreignKey: string; message: string }>
  /** Keys that now stand for another column or lookup: the grants written for them need confirming. */
  keysReassigned: ReassignedKey[]
}

/** What `POST /v1/forms/:id/restorations` answers: the version written, the one it copies, and the drift that allowed it. */
export interface Restoration {
  version: number
  restoredFrom: number
  drift: DriftReport
}

interface EvolutionOptions {
  store: ConfigurationStore
  discover: Discover
  refuse: Refuse
}

/** A version in a path or a body: a whole number from 1, at most sixteen digits, as the store names its files. */
const VERSION = /^[1-9][0-9]{0,15}$/

function versionOf(text: string): number | undefined {
  if (!VERSION.test(text)) return undefined
  const version = Number(text)
  return Number.isSafeInteger(version) ? version : undefined
}

function isVersion(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

type Regenerated = { ok: true; generated: GeneratedForm; generation: GenerationRequest; dropped: Regeneration['lookupsDropped'] } | { ok: false; message: string }

/**
 * The form generated again from the stored request against the database as
 * it is now, keeping each lookup the runtime would still build.
 *
 * First without lookups: a failure there is not a lookup's — the root, a
 * pinned or version column — and nothing can be generated. Then each lookup
 * alone, put through `buildLookupConfig` exactly as the runtime builds it
 * (0028), which refuses more than the generator does: a display column with
 * no text form, a float key. A lookup either refuses is left out with the
 * sentence that refused it, which names only approved metadata.
 */
function regenerate(bundle: BundleV2, current: MetadataSnapshot): Regenerated {
  const attempt = (lookups: LookupChoice[]) => generateForm(current, { ...bundle.generation, lookups })
  try {
    attempt([])
  } catch (error) {
    return { ok: false, message: (error as Error).message }
  }
  const kept: LookupChoice[] = []
  const dropped: Regeneration['lookupsDropped'] = []
  for (const choice of bundle.generation.lookups) {
    try {
      const trial = attempt([choice])
      const field = trial.bindings.fields.find((binding) => binding.kind === 'lookup' && binding.foreignKey === choice.foreignKey)
      if (field === undefined) throw new Error(`${choice.foreignKey} was not generated as a lookup`)
      buildLookupConfig(trial.bindings, field.field, { snapshot: current })
      kept.push(choice)
    } catch (error) {
      dropped.push({ foreignKey: choice.foreignKey, message: (error as Error).message })
    }
  }
  const generation = { ...bundle.generation, lookups: kept }
  try {
    return { ok: true, generated: generateForm(current, generation), generation, dropped }
  } catch (error) {
    return { ok: false, message: (error as Error).message }
  }
}

/**
 * Versions, regeneration and restore (0030), on the administrator plane:
 * registered by `adminRoutes` after its role check, so the check covers them.
 */
export function evolutionRoutes(app: FastifyInstance, { store, discover, refuse }: EvolutionOptions): void {
  /** Something that cannot happen for a stored, validated bundle: logged for the operator, 500 for the caller. */
  function internal(reply: FastifyReply, id: string, error: unknown) {
    reply.log.error({ form: id, error: (error as Error).message }, 'a regeneration or restore failed where it cannot')
    return refuse(reply, 500, 'internal', "This could not be completed; the operator's log says why.")
  }

  app.get<{ Params: { id: string } }>('/v1/forms/:id/versions', async (request, reply) => {
    const id = request.params.id
    const versions = FORM_ID.test(id) ? await store.versions(id) : []
    if (versions.length === 0) return refuse(reply, 404, 'unknown-form', `No form is called ${id}.`)
    return { versions }
  })

  // `/versions/latest` is a static route, which the router prefers to this one.
  app.get<{ Params: { id: string; version: string } }>('/v1/forms/:id/versions/:version', async (request, reply) => {
    const version = versionOf(request.params.version)
    if (version === undefined) return refuse(reply, 400, 'invalid-request', 'A version is a whole number from 1.')
    const loaded = await loadVersion(store, request.params.id, version, reply.log)
    if (!loaded.ok) return refuse(reply, loaded.status, loaded.code, loaded.message)
    return { version, bundle: loaded.bundle }
  })

  app.post<{ Params: { id: string } }>('/v1/forms/:id/regenerations', async (request, reply) => {
    const id = request.params.id
    const loaded = await loadPublished(store, id, reply.log)
    if (!loaded.ok) return refuse(reply, loaded.status, loaded.code, loaded.message)
    const bundle = loaded.bundle
    if (bundle.format === 1) {
      return refuse(reply, 409, 'published-before-0030', `Version ${String(loaded.version)} was published before 0030 and kept no generation request: propose the form again.`)
    }
    const current = await discover(bundle.connection, reply)
    if (current === undefined) return reply

    let drift: DriftReport
    try {
      drift = diffSnapshots(bundle.snapshot, current, bundle.bindings, bundle.policy)
    } catch (error) {
      return internal(reply, id, error)
    }
    const outcome = regenerate(bundle, current)
    if (!outcome.ok) return refuse(reply, 422, 'cannot-generate', outcome.message, { drift })
    const { generated, generation, dropped } = outcome

    let carried
    try {
      carried = rebasePresentation({ base: bundle.base, presentation: bundle.presentation, bindings: bundle.bindings }, { base: generated.form, bindings: generated.bindings })
    } catch (error) {
      return internal(reply, id, error)
    }
    const valid = validateSchema(carried.form)
    if (!valid.valid) return internal(reply, id, new Error(`the carried form is not one formancy accepts: ${valid.errors.map((entry) => entry.message).join('; ')}`))

    const regeneration: Regeneration = {
      version: loaded.version,
      drift,
      generation,
      base: generated.form,
      bindings: generated.bindings,
      notes: generated.notes,
      snapshot: current,
      policy: bundle.policy,
      policyProblems: policyProblems(current, generated.bindings, bundle.policy),
      presentation: carried.presentation,
      form: carried.form,
      conflicts: carried.conflicts,
      lookupsDropped: dropped,
      keysReassigned: reassignedKeys(bundle.bindings, generated.bindings),
    }
    return regeneration
  })

  app.post<{ Params: { id: string } }>('/v1/forms/:id/restorations', async (request, reply) => {
    const id = request.params.id
    const body = request.body
    if (!isRecord(body) || !isVersion(body['version']) || !isVersion(body['expectedBase'])) {
      return refuse(reply, 400, 'invalid-request', 'Expected { version: the version to restore, expectedBase: the newest version you saw }.')
    }
    const version = body['version']
    const loaded = await loadVersion(store, id, version, reply.log)
    if (!loaded.ok) return refuse(reply, loaded.status, loaded.code, loaded.message)
    const current = await discover(loaded.bundle.connection, reply)
    if (current === undefined) return reply

    let drift: DriftReport
    try {
      drift = diffSnapshots(loaded.bundle.snapshot, current, loaded.bundle.bindings, loaded.bundle.policy)
    } catch (error) {
      return internal(reply, id, error)
    }
    if (drift.blocking) {
      return refuse(reply, 409, 'incompatible', `Version ${String(version)} cannot be restored: the database has changed in a way it cannot serve.`, {
        changes: drift.changes.filter((change) => change.severity === 'blocking'),
      })
    }
    // The document as it was read and validated, written as the store writes every version: a copy, never a re-generation.
    // The same bytes only for a version this store wrote; one reformatted on the volume comes back in the store's spelling.
    const outcome = await store.publish(id, body['expectedBase'], loaded.bundle)
    if (!outcome.ok) return refuse(reply, 409, 'conflict', 'Somebody published first. Look at the current version and try again.', { current: outcome.current })
    const restoration: Restoration = { version: outcome.version, restoredFrom: version, drift }
    return reply.code(201).send(restoration)
  })
}
