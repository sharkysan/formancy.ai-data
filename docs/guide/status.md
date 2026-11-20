# Status

Which release Formancy Data is at, what that release added, where `main`'s
changes since are listed, and what is not yet measured or read by hand. [The
README](../../README.md#status) gives the short version.

**Status: 0.4.0, the fourth release, out on 2026-11-20.** Over 0.3.0 it adds a record saved
with the rows of its child forms in one request and one transaction
([0155](../decisions/0155-a-records-rows-may-be-saved-with-it-in-one-transaction-guarded-by-its-version-and-checked-as-a-whole.md));
a routine the database keeps, bound in the studio as an action and run
over the open record or over the records a person chose
([0159](../decisions/0159-a-form-binds-a-database-routine-as-an-action-over-the-open-record.md),
[0162](../decisions/0162-the-host-page-runs-an-action-from-the-open-records-header-after-its-dialog-and-a-confirmation-in-place-and-reads-the-record-again.md),
[0166](../decisions/0166-a-person-chooses-a-pages-records-by-a-column-of-boxes-and-runs-an-action-over-them-from-a-bar-above-the-grid.md));
a grid's filter typed as a line, and list views an administrator names
and a person keeps
([0131](../decisions/0131-a-person-types-a-grids-filter-as-a-line-and-sees-each-condition-as-a-chip.md),
[0105](../decisions/0105-a-forms-list-offers-views-its-administrator-named.md),
[0126](../decisions/0126-a-person-keeps-their-own-list-views-on-the-server-for-themselves-alone.md));
a record's child forms in tabs beside it
([0142](../decisions/0142-a-records-child-forms-are-tabs-beside-it.md));
a status field held to the moves its policy lists, and a table of versions
changed from a date
([0112](../decisions/0112-a-policy-holds-a-state-field-to-the-moves-it-lists.md),
[0113](../decisions/0113-a-form-over-versions-changes-the-open-one-from-a-date.md));
a new record's fields started at their columns' defaults or at a value an
administrator gives, and a select of the values a check lists
([0149](../decisions/0149-a-new-record-starts-with-its-columns-constant-default.md),
[0150](../decisions/0150-an-administrator-gives-a-field-another-starting-value.md),
[0152](../decisions/0152-a-column-whose-values-a-check-lists-is-a-select-of-them.md));
the server's stamps of who wrote a record and when
([0153](../decisions/0153-the-server-stamps-who-wrote-a-record-and-when.md));
and the studio's Browse step, for a browse role
([0099](../decisions/0099-a-browse-role-reads-any-table-or-views-rows-as-the-connections-account-does.md)).
[`CHANGELOG.md`](../../CHANGELOG.md)'s 0.4.0 section says what else changed,
what to do when upgrading from 0.3.0, and what is knowingly missing; its
*Unreleased* says what is on `main` since. The examples page at
https://formancy.ai/data/examples/
([0069](../decisions/0069-the-examples-page-is-served-at-formancy-ai-data-examples.md))
and the [live demo](live-demo.md) at https://formancy.ai/data/demo/
([0070](../decisions/0070-the-live-demo-runs-the-real-server-and-postgresql-in-a-cloudflare-container-of-each-visitors-own.md))
are deployed by Cloudflare from `main`, not from a release. Each line
under [*What it does*](capabilities.md) links the decision record whose **Verified by**
names what fails when the line stops being true. Not yet: performance
figures measured on this release -- [the performance page](../performance.md)
describes 0.1.0
([0084](../decisions/0084-a-release-does-not-wait-for-the-performance-figures-to-be-measured-again.md))
-- and any for a page of records, a file of them, the menu of forms, a
delete, a save or an action; a host page on another origin run in a browser; a run through a real
Cloudflare tunnel; anything that reads what Cloudflare sends at the
examples page's address, which was read by hand once, on 2026-10-16, or
a sign-in to the live demo on Cloudflare, which was read by hand on
2026-10-19
([0088](../decisions/0088-the-demo-image-makes-postgresqls-socket-directory-at-every-start-and-the-gate-runs-it-with-run-empty.md));
a test that logs in as an Entra principal; and a licence a lawyer has
reviewed.
