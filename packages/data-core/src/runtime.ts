import type { FormSchema } from '@formancy/spec'
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

/**
 * What a list of a form's records may be searched and sorted by, for one
 * person (0044): field keys in the bindings' order, from `listColumns`.
 * `sortable` holds the readable column fields whose kind has canonical text,
 * `searchable` those of kind text or integer, matched as a lookup's search
 * matches. A lookup field is neither: a list holds its token, not its label.
 */
export interface ListColumns {
  searchable: string[]
  sortable: string[]
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
 * `null` otherwise (0050).
 */
export interface PublishedForm {
  form: FormSchema
  operations: PolicyOperation[]
  readable: string[]
  list: ListColumns | null
  deleting: Deleting | null
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

/**
 * `POST /v1/forms/:id/records/list`: one page of a form's records (0044), as
 * `validateListQuery` returns it from a body. A POST, so the search never
 * appears in a URL a proxy logs. In a body every property may be left out:
 * `search` is then `''`, `sort` `[]`, `parent` `null`, `offset` 0 and
 * `limit` `LIST_PAGE_SIZE`.
 *
 * `parent` narrows the list to the rows whose lookup field `field` holds
 * `record`, a token of the row it references -- the children of one parent.
 * It is a narrowing and never a permission: the form's own read filter and
 * throughs still decide which rows exist.
 */
export interface RecordListQuery {
  search: string
  sort: ListSortTerm[]
  parent: { field: string; record: string } | null
  offset: number
  limit: number
}

/**
 * `POST /v1/forms/:id/records/export`: one CSV file of every record a list
 * would page through for the same search, sort and parent (0079), as
 * `validateExportQuery` returns it from a body. No offset and no limit: the
 * server pages the list itself, from the first record to the last, under
 * the read right a list has and no other. A POST, so the search never
 * appears in a URL, as a list's does not. In a body every property may be
 * left out, as in a list's.
 */
export type RecordExportQuery = Pick<RecordListQuery, 'search' | 'sort' | 'parent'>

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
 * nor time, since a page's cost grows with its offset.
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
 */
export interface RecordList {
  rows: FormRecord[]
  hasMore: boolean
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
  /** `delete` since 0050. */
  operation: 'create' | 'update' | 'delete'
  /** Update and delete: the token sent. Create: `intendedRecord(...)`, or null when the database numbers the key. */
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
