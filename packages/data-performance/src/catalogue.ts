import { sizedResolveKeys, sizedRowsRead } from '@formancy/data-fixtures'
import type { Catalogue } from './results.js'

/*
 * Every request the measurement sends, what it is called on the page, and
 * the database round trips each one makes on each engine, pinned (0034).
 *
 * The pins are what the hop counted in the counting pass (P4) and what the
 * drivers' code predicts: two round trips per adapter statement on both
 * engines today, because mssql checks a pooled connection with `SELECT 1`
 * before every statement and postgres.js has the server describe an
 * unprepared statement before running it. A lookup and a resolve are one
 * statement. Since 0041 every record request is decided over a description
 * of the form's own table read in that request: opening the form is that
 * description, one statement; a read returns it from the statement that
 * reads the record, still one; a create describes the table, checks the
 * customer's membership and inserts, three; an update reads the record, the
 * description with it, and then updates it, two -- PostgreSQL under READ
 * COMMITTED, the fixture's default, as on SQL Server. A run whose count
 * differs refuses, and a change that adds a statement updates the pin here,
 * which makes the published figures stale until they are measured again:
 * this file is part of what the release check digests.
 *
 * The refusals are counted and never timed: a write the runtime refuses
 * because drift review stops it (0041) must send nothing to the database
 * past the description it was decided over, which is one statement for a
 * create and the update's own read for an update.
 *
 * Rows read are `sizedRowsRead()` of `@formancy/data-fixtures`, the same
 * expectation both adapters' sized suites (`lookups-sized.integration.test.ts`)
 * import and pin: the measured tenant's rows for a tenant-filtered search,
 * the whole table on a form with no tenant row filter, at most one row per key
 * resolved. A changed expectation in either suite is a change there, which
 * changes this catalogue with it and, through the release check, makes the
 * figures stale. Nothing holds what a read, a create or an update reads, so
 * the page says nothing about it.
 */
const READ = sizedRowsRead()
/** The keys `resolve-100` asks for: the most one request may. */
const RESOLVE_KEYS = sizedResolveKeys(100).length

export const CATALOGUE: Catalogue = {
  scenarios: [
    { name: 'health', label: 'Health check', form: null, inFlight: 'all', latency: true, roundTrips: { pg: 0, ms: 0 }, rowsRead: null },
    { name: 'form', label: 'Open the form', form: 'order', inFlight: 'all', latency: true, roundTrips: { pg: 2, ms: 2 }, rowsRead: null },
    { name: 'lookup-first-page', label: 'Open the customer lookup', form: 'order', inFlight: 'all', latency: true, roundTrips: { pg: 2, ms: 2 }, rowsRead: { exactly: READ.tenant } },
    { name: 'lookup-common', label: 'Search many customers match', form: 'order', inFlight: 'all', latency: true, roundTrips: { pg: 2, ms: 2 }, rowsRead: { exactly: READ.tenant } },
    { name: 'lookup-unique', label: 'Search one customer matches', form: 'order', inFlight: 'all', latency: true, roundTrips: { pg: 2, ms: 2 }, rowsRead: { exactly: READ.tenant } },
    { name: 'lookup-absent', label: 'Search no customer matches', form: 'order', inFlight: 'all', latency: true, roundTrips: { pg: 2, ms: 2 }, rowsRead: { exactly: READ.tenant } },
    { name: 'lookup-first-page-unfiltered', label: 'Open the customer lookup', form: 'order-unfiltered', inFlight: 'one', latency: false, roundTrips: { pg: 2, ms: 2 }, rowsRead: { exactly: READ.table } },
    { name: 'lookup-common-unfiltered', label: 'Search many customers match', form: 'order-unfiltered', inFlight: 'one', latency: false, roundTrips: { pg: 2, ms: 2 }, rowsRead: { exactly: READ.table } },
    { name: 'lookup-unique-unfiltered', label: 'Search one customer matches', form: 'order-unfiltered', inFlight: 'one', latency: false, roundTrips: { pg: 2, ms: 2 }, rowsRead: { exactly: READ.table } },
    { name: 'lookup-absent-unfiltered', label: 'Search no customer matches', form: 'order-unfiltered', inFlight: 'one', latency: false, roundTrips: { pg: 2, ms: 2 }, rowsRead: { exactly: READ.table } },
    { name: 'resolve-1', label: 'Resolve one stored customer', form: 'order', inFlight: 'all', latency: true, roundTrips: { pg: 2, ms: 2 }, rowsRead: { atMost: READ.perKey } },
    { name: 'resolve-100', label: 'Resolve the most one request may ask', form: 'order', inFlight: 'all', latency: true, roundTrips: { pg: 2, ms: 2 }, rowsRead: { atMost: READ.perKey * RESOLVE_KEYS } },
    { name: 'read', label: 'Read an order', form: 'order', inFlight: 'all', latency: true, roundTrips: { pg: 2, ms: 2 }, rowsRead: null },
    { name: 'create', label: 'Create an order', form: 'order', inFlight: 'all', latency: true, roundTrips: { pg: 6, ms: 6 }, rowsRead: null },
    { name: 'update', label: 'Update an order', form: 'order', inFlight: 'all', latency: true, roundTrips: { pg: 4, ms: 4 }, rowsRead: null },
  ],
  refusals: [
    { name: 'create-drifted', label: 'Create, on a form whose table narrowed after it was published', answer: { status: 409, code: 'drift' }, roundTrips: { pg: 2, ms: 2 } },
    { name: 'update-drifted', label: 'Update, on a form whose table narrowed after it was published', answer: { status: 409, code: 'drift' }, roundTrips: { pg: 2, ms: 2 } },
  ],
  floor: { label: 'One parameterised select as the writer', roundTrips: { pg: 2, ms: 2 } },
}
