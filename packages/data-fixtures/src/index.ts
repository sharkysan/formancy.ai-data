export { accessDisagreements, READER_ACCESS, WRITER_ACCESS } from './access.js'
export type { ExpectedAccess, ExpectedCapability, ExpectedObjectAccess, ExpectedObjectFacts } from './access.js'
export {
  browseCase,
  covers,
  cascadeCase,
  columnFilterCase,
  deleteCase,
  displayCase,
  driftingCase,
  edgeCase,
  exportCase,
  filterCase,
  listCase,
  MODEL_CASES,
  refusalCase,
  sharedCases,
  shipmentCase,
  temporalCase,
  THROUGH_CASES,
  throughCase,
  UPDATE_RECREATED_CASE,
  uuidCase,
} from './cases.js'
export { DELETE_PARITY, deleteAnswer, UPDATE_RECREATED } from './deletes.js'
export { BROWSE_PARITY } from './browse.js'
export type { BrowseCase } from './browse.js'
export { COLUMN_FILTER_PARITY, COLUMN_FILTER_ROWS, COLUMN_FILTER_TENANT } from './column-filters.js'
export type { ColumnFilterCase } from './column-filters.js'
export { CASCADE_PARITY, cascadeAnswer, PARITY_CASCADES, REACH_PRIVILEGE_LOSSES } from './cascades.js'
export type { CascadeCase } from './cascades.js'
export type { DeleteAnswer, DeleteCase, DeleteExpectation } from './deletes.js'
export type { ThroughCase } from './cases.js'
export {
  READER,
  SQLSERVER_DATABASE,
  startPostgresContainer,
  startPostgresFixture,
  startSqlServerContainer,
  startSqlServerFixture,
  WRITER,
} from './containers.js'
export { DEFAULT_IMAGES, imageMajor, IMAGES_VARIABLE, MATRIX_IMAGES, POSTGRES_IMAGE, selectedImage, selectedImages, SQLSERVER_IMAGE } from './images.js'
export type { PostgresFixture, SqlServerFixture, SqlServerStart, StartedServer } from './containers.js'
export { restrictedDisagreements, snapshotDisagreements, structuralDisagreements } from './conformance.js'
export { defined } from './defined.js'
export type { DefinedRecords, Undefined } from './defined.js'
export { connectDocker } from './docker.js'
export type { DockerContainer, DockerContainerFacts, DockerDaemon, DockerReader } from './docker.js'
export { DRIFTING, driftingOn, runtimeOf, sharedDrifting } from './drifting.js'
export type { DriftingCase, DriftSend, DriftVerdict } from './drifting.js'
export { EXPORT_PARITY, EXPORT_ROWS } from './exports.js'
export type { ExportCase } from './exports.js'
export { LIST_PARITY, LIST_ROWS } from './lists.js'
export type { ListCase } from './lists.js'
export { readFixture, splitBatches } from './load.js'
export type { FixtureFile } from './load.js'
export { FIXTURE_MODEL, FIXTURE_SCOPE } from './model.js'
export type { ExpectedCheck, ExpectedCheckFacts, ExpectedColumn, ExpectedColumnFacts, ExpectedForeignKey, ExpectedObject, ExpectedType } from './model.js'
export { DISPLAY_PARITY, FILTER_PARITY, PARITY_SCOPE, REFUSAL_PARITY, TEMPORAL_PARITY } from './parity.js'
export type { FilterParityCase, ParityFilterColumn, RefusalParityCase } from './parity.js'
export { renamedColumn } from './rename.js'
export { EDGE_VALUES, FIRST_SHIPMENT, SECOND_SHIPMENT } from './values.js'
export { DELIVERIES, UUID_PARITY, UUID_ROWS, uuidOrder } from './uuid.js'
export type { UuidCase } from './uuid.js'
export { answerBytes, startTcpHop } from './tcp-hop.js'
export { PRELOGIN_ENCRYPTION, preloginAnswer, preloginPayload, startPreloginStandIn, TDS_PACKET, tdsPacket } from './prelogin.js'
export type { PreloginStandIn } from './prelogin.js'
export { blockTable } from './blocking.js'
export type { BlockedTable, BlockingDatabase } from './blocking.js'
export type { HopKind, LostAnswer, Schedule, SentOn, TcpHop } from './tcp-hop.js'
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
export { insertPaged, PAGED_LATER, PAGED_ORDERS, PAGED_TENANT, pagedCustomers, pagedOrderNotes } from './paged.js'
export type { PagedCustomer, PagedTarget } from './paged.js'
export type { ServerAnswer, ServerRecord } from './servers.js'
// For a suite that starts its own container through startPostgresContainer or
// startSqlServerContainer and keeps it in a typed variable, without declaring
// testcontainers itself (0035).
export type { StartedMSSQLServerContainer } from '@testcontainers/mssqlserver'
export type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'
export { serverMajor, VERSION_FACTS, versionFact } from './versions.js'
export type { VersionFact, VersionFactName } from './versions.js'
