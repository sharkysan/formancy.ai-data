export { createDataServer } from './app.js'
export type { DataServerOptions } from './app.js'
export { createFileConfigurationStore, UnparsableVersionError } from './config-store.js'
export type { ConfigurationStore, PublishOutcome } from './config-store.js'
// The host's identity lives in @formancy/data-identity (0091), and is
// re-exported here under the names it always had, the very same objects:
// index.test.ts fails on a copy. A key set (0059): made only by readKeySet
// and the builders, which an embedder's `keys` returns; and the file read
// again whenever it is asked.
export { createIdentityVerifier, KeySet, KeySetRefusal, openKeySetFile, readKeySet, resolveSecret } from '@formancy/data-identity'
export type {
  HostIdentity,
  IdentityOptions,
  IdentityOutcome,
  IdentityVerifier,
  KeySetAlgorithm,
  KeySetChange,
  KeySetFile,
  KeySetReadAgain,
  LeftOutKey,
  OneKey,
  SecretSource,
} from '@formancy/data-identity'
export { validateBundle } from './bundle.js'
export type { BundleV1, BundleV2, BundleValidation, PublishedBundle } from './bundle.js'
// What the connection test answers: the server, and whether this release was tested on it (0068).
export type { ConnectionTest } from './routes/admin.js'
export type { Regeneration, Restoration } from './routes/admin-evolution.js'
export type { Importation } from './routes/admin-promotion.js'
// Publication under review (0065): the answers of the administration and draft routes.
export type { Administration, DraftRefuses, GovernanceCode, Refused } from './governance.js'
export type { DraftState } from './drafts.js'
export type { Approval, DraftQueue, DraftRead, DraftRejection, DraftSubmission, QueuedDraft } from './routes/admin-drafts.js'
export { createConnectionRegistry, parseConnections } from './connections.js'
export type { ConnectionConfig, ConnectionFactory, ConnectionRegistry, OpenConnection } from './connections.js'
export { DRIVER_FACTORIES } from './drivers.js'
// The runtime plane's routes, `METHOD url`, each with its audit name: what a
// host is allowed to send, which the host page's suite holds itself to (0047).
export { ROUTE_OPERATIONS } from './routes/runtime.js'
export type { RuntimeOperation } from './audit.js'
export { logAuditSink, recordReference } from './audit.js'
export type { AdminAuditEvent, AuditEvent, AuditSink, RuntimeAuditEvent } from './audit.js'
