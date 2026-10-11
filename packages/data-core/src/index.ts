export { DATABASE_KINDS, isDatabaseKind } from './adapter.js'
export type { DatabaseAdapter, DatabaseKind, ServerIdentity } from './adapter.js'
export { createSnapshot, findObject, gapCovers, inSnapshotOrder, isComplete } from './snapshot.js'
export type {
  CheckMeta,
  ColumnAccess,
  ColumnMeta,
  CoverageAspect,
  CoverageGap,
  CoverageSubject,
  DiscoveryAccount,
  DiscoveryScope,
  ForeignKeyMeta,
  ForeignKeyTarget,
  Generation,
  KeyMeta,
  MetadataSnapshot,
  NormalizedType,
  NormalizedTypeKind,
  ObjectMeta,
  ObjectRef,
  ReferentialAction,
  RowSecurity,
  TextLengthUnit,
} from './metadata.js'
export { generateForm } from './generate/generate.js'
export { BINDINGS_VERSION, bindingsVersionProblem, GENERATED_SPEC_VERSION } from './generate/version.js'
export type {
  ConcurrencyBinding,
  FieldBinding,
  FieldWrites,
  FormBindings,
  GeneratedForm,
  GenerationNote,
  GenerationRequest,
  LookupChoice,
} from './generate/types.js'
export { describedOf, diffRootDefinition, diffSnapshots, ROOT_DEFINITION } from './drift/diff.js'
export type { DescribedRoot } from './drift/diff.js'
export type { DriftChange, DriftKind, DriftReport, DriftSeverity, DriftSubject, DriftVerdict } from './drift/types.js'
export { applyPresentation, presentationShapeProblems } from './presentation/apply.js'
export { presentationOf } from './presentation/derive.js'
export { describeReassigned, grantsOnKey, reassignedKeys, rebasePresentation } from './presentation/rebase.js'
export { EMPTY_PRESENTATION, fieldAnchor, PRESENTATION_VERSION } from './presentation/types.js'
export type {
  FieldAnchor,
  FieldPresentation,
  PresentationCheck,
  PresentationConflict,
  PresentationOverrides,
  PresentedForm,
  ReassignedKey,
  RebasedPresentation,
  SectionAnchor,
  SectionPresentation,
} from './presentation/types.js'

export { decodeKeyToken, encodeKeyToken, KEY_TOKEN_MAX_LENGTH } from './lookup/token.js'
export type { KeyTokenDecoding, KeyTokenEncoding, KeyTokenErrorCode, KeyTokenRefusal } from './lookup/token.js'
export { MAX_SEARCH_LENGTH, validateLookupQuery } from './lookup/query.js'
export type { LookupQueryCheck, LookupQueryErrorCode } from './lookup/query.js'
export { formatLabel, LABEL_SEPARATOR } from './lookup/label.js'
export { buildLookupConfig, DEFAULT_MAX_PAGE_SIZE } from './lookup/config.js'
export type { LookupOptions, LookupSortChoice } from './lookup/config.js'
export { lookupKeys, lookupPage, rejectedTokens, resolvedRows } from './lookup/rows.js'
export type { FoundRow } from './lookup/rows.js'
export { rowFilterColumnProblem, rowFilterTerms, scopeRowFilters } from './lookup/filters.js'
export type { FilterScoping } from './lookup/filters.js'
export { displayText } from './lookup/display.js'
export type {
  LookupAdapter,
  LookupConfig,
  LookupDisplayColumn,
  LookupDisplayType,
  LookupKeyColumn,
  LookupKeyType,
  LookupMembership,
  LookupQuery,
  LookupResolve,
  LookupResult,
  LookupRow,
  LookupSearch,
  LookupSearchColumn,
  LookupSearchType,
  LookupSort,
  RowFilterTerm,
  RowFilters,
  RowFilterType,
} from './lookup/types.js'

export { codecFor } from './codecs/codec.js'
export type { ApiValue, Codec, CodecOutcome } from './codecs/codec.js'
export { canonicalFloat32 } from './codecs/numbers.js'
export { decodeRowversion, encodeRowversion } from './codecs/rowversion.js'
export { authorizeOperation, checkSubmittedFields, forcedValues, lookupRowFilter, readableFields, rowFilter, throughFilters } from './policy/evaluate.js'
export { validatePolicy } from './policy/validate.js'
export { isThroughKeyType, throughProblems } from './policy/through.js'
export type { ThroughKeyType } from './policy/through.js'
export type {
  FieldPolicy,
  ForcedValues,
  FormPolicy,
  PolicyContext,
  PolicyDecision,
  PolicyOperation,
  PolicyRefusal,
  PolicyRefusalCode,
  PolicyValidation,
  ReadableFields,
  RowFilter,
  RowFilterResult,
  RowFilterRule,
  ThroughFilters,
} from './policy/types.js'
export type {
  DescribedColumn,
  Described,
  DescribedRead,
  DescribedTable,
  InsertRequest,
  ReadRequest,
  RecordAdapter,
  RecordColumn,
  RecordConcurrency,
  RecordFailure,
  RecordFailureCode,
  RecordOutcome,
  RecordRead,
  RecordTarget,
  RecordValue,
  Through,
  UpdateRequest,
} from './records/types.js'
export { planCreate, planRead, planUpdate } from './records/plan.js'
export { throughTerms } from './records/through.js'
export type { ThroughTerms } from './records/through.js'
export { driftRefusal, NOTHING_LEFT, READ_REFUSED, runtimeOperations, WRITE_REFUSED } from './records/drift.js'
export { rejectedSelection, toFormAnswers } from './records/answers.js'
export { decodeRecordKey, intendedRecord, recordToken } from './records/token.js'
export type { RecordKeyDecoding, RecordTokenEncoding, RecordTokenErrorCode, RecordTokenRefusal } from './records/token.js'
export type {
  FieldError,
  FormRecord,
  InvalidValues,
  MembershipCheck,
  PlannedInsert,
  PlannedRead,
  PlannedUpdate,
  PlanRefusal,
  PlanRefusalCode,
} from './records/plan-types.js'
export type { PublishedForm, ResolvedLookup, RuntimeRefusal, UnknownOutcome } from './runtime.js'
export { WRITE_ID_HEADER } from './runtime.js'
