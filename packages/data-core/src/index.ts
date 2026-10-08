export { DATABASE_KINDS, isDatabaseKind } from './adapter.js'
export type { DatabaseAdapter, DatabaseKind, ServerIdentity } from './adapter.js'
export { createSnapshot, findObject, isComplete } from './snapshot.js'
export type {
  CheckMeta,
  ColumnMeta,
  CoverageAspect,
  CoverageGap,
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
} from './metadata.js'
export { generateForm } from './generate/generate.js'
export type {
  ConcurrencyBinding,
  FieldBinding,
  FormBindings,
  GeneratedForm,
  GenerationNote,
  GenerationRequest,
  LookupChoice,
} from './generate/types.js'
export { diffSnapshots } from './drift/diff.js'
export type { DriftChange, DriftKind, DriftReport, DriftSeverity, DriftSubject } from './drift/types.js'

export { decodeKeyToken, encodeKeyToken, KEY_TOKEN_MAX_LENGTH } from './lookup/token.js'
export type { KeyTokenDecoding, KeyTokenEncoding, KeyTokenErrorCode, KeyTokenRefusal } from './lookup/token.js'
export { MAX_SEARCH_LENGTH, validateLookupQuery } from './lookup/query.js'
export type { LookupQueryCheck, LookupQueryErrorCode } from './lookup/query.js'
export { formatLabel, LABEL_SEPARATOR } from './lookup/label.js'
export { buildLookupConfig, DEFAULT_MAX_PAGE_SIZE } from './lookup/config.js'
export type { LookupOptions, LookupSortChoice } from './lookup/config.js'
export { lookupKeys, lookupPage, rejectedTokens, resolvedRows } from './lookup/rows.js'
export type { FoundRow } from './lookup/rows.js'
export { lookupFilters, rowFilterTerms } from './lookup/filters.js'
export type {
  LookupAdapter,
  LookupConfig,
  LookupKeyColumn,
  LookupKeyType,
  LookupMembership,
  LookupQuery,
  LookupResolve,
  LookupResult,
  LookupRow,
  LookupSearch,
  LookupSort,
  RowFilterTerm,
  RowFilters,
} from './lookup/types.js'

export { codecFor } from './codecs/codec.js'
export type { ApiValue, Codec, CodecOutcome } from './codecs/codec.js'
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
