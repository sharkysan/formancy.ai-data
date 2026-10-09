export { DATABASE_KINDS, isDatabaseKind } from './adapter.js'
export type { DatabaseAdapter, DatabaseKind, ServerIdentity } from './adapter.js'
export { createSnapshot, findObject, gapCovers, isComplete } from './snapshot.js'
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
export { BINDINGS_VERSION, bindingsVersionProblem } from './generate/version.js'
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
export { diffSnapshots } from './drift/diff.js'
export type { DriftChange, DriftKind, DriftReport, DriftSeverity, DriftSubject } from './drift/types.js'
export { applyPresentation, presentationShapeProblems } from './presentation/apply.js'
export { presentationOf } from './presentation/derive.js'
export { reassignedKeys, rebasePresentation } from './presentation/rebase.js'
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
export { authorizeOperation, checkSubmittedFields, forcedValues, lookupRowFilter, readableFields, rowFilter } from './policy/evaluate.js'
export { validatePolicy } from './policy/validate.js'
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
} from './policy/types.js'
export type {
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
  UpdateRequest,
} from './records/types.js'
export { planCreate, planRead, planUpdate } from './records/plan.js'
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
