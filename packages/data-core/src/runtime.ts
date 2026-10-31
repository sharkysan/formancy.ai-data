import type { FormSchema } from '@formancy/spec'
import type { ApiValue } from './codecs/codec.js'
import { DEFAULT_MAX_PAGE_SIZE } from './lookup/config.js'
import type { LookupRow } from './lookup/types.js'
import type { PolicyOperation } from './policy/types.js'
import type { FieldError, FormRecord } from './records/plan-types.js'

/*
 * The runtime plane's replies that have no type of their own elsewhere in the
 * core, declared once so that the server that sends them and the client that
 * reads them compile against the same shape (0029). A record is `FormRecord`
 * and a search is `LookupResult`, which the planner and the adapters already
 * return; these are the ones the server used to build by hand.
 *
 * Shapes, and the one header name both sides use. Nothing here checks a
 * reply: the client reads what arrives as `unknown` and the server's handlers
 * are annotated with these, so a change on either side is a type error on the
 * other before it is a blank form.
 */

/** What a filter's condition asks of its column (0104). */
export type FilterOp = 'equals' | 'range' | 'contains' | 'null' | 'not-null'

/**
 * One condition on one column, as a request carries it (0104): values as
 * the text a person typed, which the planner checks and spells as the
 * column holds them (`records/filter.ts`). A range has a `from`, a `to` or
 * both, each inclusive; a timestamp's are dates, and its range whole days.
 * `null` is the column holding NULL, and text of no characters is a value.
 */
export type FilterCondition =
  | { op: 'equals'; value: string }
  | { op: 'range'; from: string | null; to: string | null }
  | { op: 'contains'; text: string }
  | { op: 'null' }
  | { op: 'not-null' }

/** What a filter's value or bound is typed as. A timestamp's bounds are dates. */
export type FilterInput = 'text' | 'integer' | 'decimal' | 'date' | 'uuid' | 'boolean'

/**
 * Whose clock a timestamp's whole days are counted on (0104): `utc` for an
 * instant, which a page shows in UTC, and `wall` for a timestamp in no
 * zone, as its values are stored.
 */
export type FilterDays = 'utc' | 'wall'

/**
 * What one column offers a filter (0104): its operators, in the order a
 * panel lists them, what a value is typed as -- `null` when it offers only
 * `null` and `not-null` -- and, for a timestamp, whose clock its range's
 * days are on, `null` for every other kind, so a page says it without
 * guessing from the field it draws.
 */
export interface FilterOffer {
  operators: FilterOp[]
  input: FilterInput | null
  days: FilterDays | null
}

/** A field a list may be filtered by, and what it offers. */
export type FilterableField = { field: string } & FilterOffer

/**
 * A view of a form's list its administrator named (0105): conditions and an
 * order a person picks together, each term exactly what a list request
 * carries (`ListFilterTerm`, `ListSortTerm`), so a picked view is a list
 * request and nothing else. `default` is `true` on the one view a grid opens
 * on, and absent on every other.
 */
export interface ListView {
  name: string
  filter: ListFilterTerm[]
  sort: ListSortTerm[]
  default?: true
}

/**
 * What a list of a form's records may be searched, sorted and filtered by,
 * for one person (0044): field keys in the bindings' order, from
 * `listColumns`. `sortable` holds the readable column fields whose kind has
 * canonical text, `searchable` those of kind text or integer, matched as a
 * lookup's search matches, and `filterable` those `filterOffer` offers a
 * condition on (0104). A lookup field is none of them: a list holds its
 * token, not its label. `views` holds the published views this person
 * could have built from the rest, in their published order (0105).
 */
export interface ListColumns {
  searchable: string[]
  sortable: string[]
  filterable: FilterableField[]
  views: ListView[]
}

/**
 * What deleting a record of a published form does besides removing it
 * (0050), for a page to word its confirmation by -- never by table names.
 *
 * `cascades` and `clears` say whether the policy's `cascades` accepts a key
 * that deletes other rows, or sets NULL or a default in them (0051).
 * `restricted` says whether the snapshot shows a key that refuses a delete
 * while a row refers to the record, or to a row the delete reaches, so the
 * database may keep it.
 */
export interface Deleting {
  cascades: boolean
  clears: boolean
  restricted: boolean
}

/**
 * `GET /v1/forms/:id`: the published document, what this person may do with
 * it, and which of its fields they may see.
 *
 * `operations` is never empty: a person the policy grants nothing is refused
 * with 403 rather than handed a form they cannot use. `readable` is the field
 * keys the policy lets them read, in the bindings' order; a field outside it
 * arrives in no record. `list` is what a list of its records may be searched
 * and sorted by, or `null` when `listable` refuses this person a list -- a
 * key that can be NULL, or one held in a field they may not read -- so a
 * page never offers a grid the server would refuse (0044). `deleting` is
 * what a delete also does, exactly when `operations` holds `delete`, and
 * `null` otherwise (0050). `copied` is the fields a copy of a record carries
 * into a new one, from `copiedFields`, exactly when `operations` holds
 * `create`, and `null` otherwise (0107). `versions` is the fields a version
 * starts and ends at where the form's rows are versions of one thing and
 * this person may change the open one from a date -- `operations` holds
 * both `create` and `update` -- and `null` otherwise (0113); with `key`,
 * the fields of the chain's key, which a next version takes from the one
 * it follows, so a page draws them unwritable (0115). `writable` is the
 * fields this person may give on each write, from `writableFields`: on
 * create `null` exactly when `operations` holds no `create`, on update
 * exactly when it holds no `update` -- so a page draws a field in neither
 * as one nothing writes, and sends it in no body (0117).
 */
export interface PublishedForm {
  form: FormSchema
  operations: PolicyOperation[]
  readable: string[]
  list: ListColumns | null
  deleting: Deleting | null
  copied: string[] | null
  versions: { from: string; to: string; key: string[] } | null
  writable: { create: string[] | null; update: string[] | null }
}

/**
 * A child of a form in a person's menu (0045): the child form, and its
 * lookup field that references the parent's records. A page lists the
 * parent record's children by asking the child form's list with
 * `parent: { field, record }`.
 */
export interface FormMenuChild {
  form: string
  field: string
  /**
   * Whether the child form is a section of this form's records (0109): its
   * rows' key is the field's foreign key, so a record has at most one of
   * them, which a page shows under the record as a form of its own rather
   * than a grid.
   */
  one: boolean
  /**
   * Where `one`, the field of this form whose answer shows the section and
   * the answer that does, as the record's own answers hold it; `null` shows
   * it always -- a section with no condition, and one whose condition is on
   * a column this person may not read here, since what a page shows is
   * never a permission.
   */
  when: { field: string; equals: ApiValue } | null
}

/**
 * One form in a person's menu: its id and title, the operations the policy
 * grants them of what the form offers as published, and the children under
 * it. Opening it (`GET /v1/forms/:id`) narrows the operations to what the
 * database as it is now still allows, and says whether a list is offered
 * now: the menu asks no database (0045).
 */
export interface FormMenuEntry {
  id: string
  title: string
  operations: PolicyOperation[]
  children: FormMenuChild[]
}

/**
 * `GET /v1/forms`: the published forms this person may read, in codepoint
 * order of their ids, and nothing about any other (0045).
 */
export interface FormMenu {
  forms: FormMenuEntry[]
}

/**
 * The most records one list page holds (0044), and the limit a request that
 * names none gets.
 *
 * Equal to `DEFAULT_MAX_PAGE_SIZE`, so that no page the runtime plane returns
 * -- a lookup's options or a form's records -- is longer than one bound; and
 * at most the server's `MAX_RESOLVE`, which a test holds, so one page's
 * tokens for one lookup field fit one resolve. Not measured for a grid's
 * rows: the lookup's own number is formancy's select default, and nothing
 * here has timed a page of wide records. 0044 names what would measure it.
 */
export const LIST_PAGE_SIZE = DEFAULT_MAX_PAGE_SIZE

/** One term of a list's requested order: a field key and a direction. */
export interface ListSortTerm {
  field: string
  direction: 'asc' | 'desc'
}

/** One condition of a list's filter (0104): a field key and what it asks of the field's column. */
export type ListFilterTerm = { field: string } & FilterCondition

/**
 * `POST /v1/forms/:id/records/list`: one page of a form's records (0044), as
 * `validateListQuery` returns it from a body. A POST, so the search never
 * appears in a URL a proxy logs. In a body every property may be left out:
 * `search` is then `''`, `sort` `[]`, `parent` `null`, `after` `null` and
 * `limit` `LIST_PAGE_SIZE`.
 *
 * `after` is the `next` of the page before, in the same order (0108): the
 * page holds the rows that come after the row that page ended with, and
 * `null` asks for the first page. A cursor is the server's spelling of a
 * row's key, read by nothing else; sent with another sort, it continues
 * after that row in the new order.
 *
 * `parent` narrows the list to the rows whose lookup field `field` holds
 * `record`, a token of the row it references -- the children of one parent
 * -- or, with `record` `null`, to the rows whose field references no row,
 * every one of its columns NULL: a tree's roots (0110).
 * `filter` narrows it to the rows every condition holds for, each field
 * named once (0104); `[]` when left out. Both are narrowings and never a
 * permission: the form's own read filter and throughs still decide which
 * rows exist.
 */
export interface RecordListQuery {
  search: string
  sort: ListSortTerm[]
  parent: { field: string; record: string | null } | null
  filter: ListFilterTerm[]
  after: string | null
  limit: number
}

/**
 * `POST /v1/forms/:id/records/export`: one CSV file of every record a list
 * would page through for the same search, sort, parent and filter (0079,
 * 0104), as `validateExportQuery` returns it from a body. No cursor and no
 * limit: the server pages the list itself, from the first record to the
 * last, under the read right a list has and no other. A POST, so the search
 * never appears in a URL, as a list's does not. In a body every property
 * may be left out, as in a list's.
 */
export type RecordExportQuery = Pick<RecordListQuery, 'search' | 'sort' | 'parent' | 'filter'>

/**
 * The most bytes an exported file may have (0079): 16 MiB of UTF-8, the
 * byte-order mark included. A file that would be larger is refused whole,
 * never cut short. Declared here so the server that counts and the client
 * that receives compile against one number.
 *
 * A budget, not a measurement: what one export may hold in the server's
 * memory -- the text being built, then the bytes sent, about twice this --
 * and in a browser's, which holds the whole file before it saves it. A
 * round number, chosen 2026-10-17 so that the server's worst case, one
 * export at a time per allowlisted connection, stays at tens of megabytes
 * for a deployment of a few connections; nothing has measured an export.
 * Not a row cap, which would bound neither memory, since a row can be wide,
 * nor time, since what a page reads depends on the order and the indexes.
 */
export const EXPORT_MAX_BYTES = 16 * 1024 * 1024

/**
 * The name an exported file is saved under: the form's id and `.csv`. The
 * server's `content-disposition` and the client's saved file both take it
 * from here; a form id is `[a-z0-9][a-z0-9._-]*`, so it needs no escaping.
 * No date: it would be the server's clock in one place and the browser's in
 * the other.
 */
export function exportFileName(formId: string): string {
  return `${formId}.csv`
}

/**
 * One page of records: each row exactly what `records/read` returns for its
 * token, in the requested order, and whether more rows follow. No total: a
 * COUNT would read every admitted row on every page. A row whose key does
 * not fit a token is in its place with `record: null`, so the page's
 * arithmetic holds; it cannot be opened.
 *
 * `next` is the cursor of the page's last row, which the request for the
 * page after it sends as `after` (0108): a string when more follow, `null`
 * when none do.
 */
export interface RecordList {
  rows: FormRecord[]
  hasMore: boolean
  next: string | null
}

/**
 * Every runtime refusal's body: a stable code for a program, a sentence a
 * person can be shown, and the fields it concerns when it concerns fields.
 *
 * The sentence never echoes a submitted value (0011). `fieldErrors` is present
 * on `422 invalid-values`, and on a constraint failure only when the engine
 * named a column the form binds; a refusal without it is about the record or
 * the request as a whole.
 */
export interface RuntimeRefusal {
  code: string
  message: string
  fieldErrors?: FieldError[]
}

/**
 * 502: the write was sent and its answer lost; it may have committed. Nothing
 * in this module retries it (0031). The sentence never names a value (0011):
 * what was addressed travels in `record` and `version`, for the host to
 * reconcile with.
 */
export interface UnknownOutcome extends RuntimeRefusal {
  code: 'unknown-outcome'
  /** `delete` since 0050, `supersede` -- a change from a date -- since 0113. */
  operation: 'create' | 'update' | 'delete' | 'supersede'
  /** Update, delete and supersede: the token sent. Create: `intendedRecord(...)`, or null when the database numbers the key. */
  record: string | null
  /**
   * Update and delete: the version sent -- saving again with exactly it is
   * stored at most once, and deleting again with it deletes nothing else.
   * Create: null.
   */
  version: string | null
}

/**
 * `POST /v1/forms/:id/records/delete` deleted the record (0050): the token
 * of the row the statement removed, spelled as the database held its key,
 * which under a case-insensitive key collation may differ from the one sent
 * (0028). A body, not a 204: a client counts a write done only when the
 * answer says what happened (0031). Nothing of the record's values is kept
 * for a resend to answer with.
 */
export interface RecordDeleted {
  record: string
  deleted: true
}

/**
 * The request header that names one sending of a write (0031). The client
 * makes a new one for every create and update it is asked to send; a request
 * that arrives again with it -- Chromium resends a request whose reused
 * connection closed before any answer, below the page -- is answered with the
 * first one's answer and not applied again. Declared here, the one place the
 * server that reads it and the client that sends it both import.
 */
export const WRITE_ID_HEADER = 'formancy-write-id'

/**
 * The request headers a page on another origin may send to the runtime plane
 * (0060), lower case: the ones the client sends that make a browser ask
 * first -- the token, a body's JSON type and a write's id; its `accept` is
 * one the Fetch standard lets through unasked -- and the only ones the server
 * reads. A preflight asking for any other header is refused, so a header
 * added to the client and not here fails every call from another origin;
 * the client's suite fails first. Declared here, beside the write id, for the
 * reason that is.
 */
export const CROSS_ORIGIN_REQUEST_HEADERS = ['authorization', 'content-type', WRITE_ID_HEADER] as const

/**
 * `POST /v1/forms/:id/lookups/:source/resolve`: the labels of the tokens asked
 * about that this person may see. A token they may not see is absent, not an
 * error, so the reply cannot be used to learn that another tenant's row exists
 * (0012).
 */
export interface ResolvedLookup {
  rows: LookupRow[]
}
