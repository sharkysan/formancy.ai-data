export { accessDisagreements, READER_ACCESS, WRITER_ACCESS } from './access.js'
export type { ExpectedAccess, ExpectedCapability, ExpectedObjectAccess, ExpectedObjectFacts } from './access.js'
export { displayCase, driftingCase, edgeCase, filterCase, covers, MODEL_CASES, refusalCase, sharedCases, shipmentCase, temporalCase } from './cases.js'
export {
  DEFAULT_IMAGES,
  POSTGRES_IMAGE,
  READER,
  SQLSERVER_DATABASE,
  SQLSERVER_IMAGE,
  startPostgresContainer,
  startPostgresFixture,
  startSqlServerContainer,
  startSqlServerFixture,
  WRITER,
} from './containers.js'
export type { PostgresFixture, SqlServerFixture, StartedServer } from './containers.js'
export { restrictedDisagreements, snapshotDisagreements, structuralDisagreements } from './conformance.js'
export { defined } from './defined.js'
export type { DefinedRecords, Undefined } from './defined.js'
export { connectDocker } from './docker.js'
export type { DockerContainer, DockerContainerFacts, DockerDaemon, DockerReader } from './docker.js'
export { DRIFTING, driftingOn, runtimeOf, sharedDrifting } from './drifting.js'
export type { DriftingCase, DriftSend, DriftVerdict } from './drifting.js'
export { readFixture, splitBatches } from './load.js'
export type { FixtureFile } from './load.js'
export { FIXTURE_MODEL, FIXTURE_SCOPE } from './model.js'
export type {
  ExpectedCheck,
  ExpectedCheckFacts,
  ExpectedColumn,
  ExpectedColumnFacts,
  ExpectedForeignKey,
  ExpectedObject,
  ExpectedType,
} from './model.js'
export { DISPLAY_PARITY, FILTER_PARITY, PARITY_SCOPE, REFUSAL_PARITY, TEMPORAL_PARITY } from './parity.js'
export type { FilterParityCase, ParityFilterColumn, RefusalParityCase } from './parity.js'
export { renamedColumn } from './rename.js'
export { EDGE_VALUES, FIRST_SHIPMENT, SECOND_SHIPMENT } from './values.js'
export { answerBytes, startTcpHop } from './tcp-hop.js'
export type { LostAnswer, Schedule, TcpHop } from './tcp-hop.js'
export {
  FIXTURE_CUSTOMERS,
  SIZED_CUSTOMERS,
  sizedChunk,
  sizedCountry,
  sizedCustomer,
  sizedCustomerRows,
  sizedDigest,
  sizedDigester,
  sizedLookupPage,
  sizedReadBack,
  sizedResolveKeys,
  sizedRowsRead,
  sizedTableRows,
  sizedTerms,
} from './sized.js'
export type { SizedReadBack, SizedRow } from './sized.js'
export { loadSizedCustomers, SIZED_CHUNK_ROWS, verifySizedCustomers } from './sized-load.js'
export type { SizedLoad, SizedTarget } from './sized-load.js'
export type { ServerAnswer, ServerRecord } from './servers.js'
// For a suite that starts its own container through startPostgresContainer or
// startSqlServerContainer and keeps it in a typed variable, without declaring
// testcontainers itself (0035).
export type { StartedMSSQLServerContainer } from '@testcontainers/mssqlserver'
export type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'
