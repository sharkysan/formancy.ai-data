# Status

Which release Formancy Data is at, what that release added, where `main`'s
changes since are listed, and what is not yet measured or read by hand. [The
README](../../README.md#status) gives the short version.

**Status: 0.5.0, the fifth release, out on 2026-11-22.** Over 0.4.0 it adds
the chosen records of a page deleted or changed in one request, each
record on its own and each one not done named
([0173](../decisions/0173-chosen-records-are-deleted-each-on-its-own-with-one-answer-per-record.md),
[0175](../decisions/0175-chosen-records-are-changed-each-on-its-own-to-the-values-given-in-fields-a-policy-names.md));
the host page's Delete the chosen… and Change the chosen… above the
Records grid
([0174](../decisions/0174-the-host-page-deletes-the-chosen-records-of-a-page-and-the-studio-grants-who-may.md),
[0176](../decisions/0176-the-host-page-changes-the-chosen-records-of-a-page-and-the-studio-grants-who-may-and-in-which-fields.md));
the studio's Policy step granting who may, and in which fields; and a
PostgreSQL enum, or a domain whose check lists its values, as a select of
them
([0170](../decisions/0170-an-enum-is-a-select-of-its-labels-and-a-domain-whose-check-lists-its-values-a-select-of-them.md)).
[`CHANGELOG.md`](../../CHANGELOG.md)'s 0.5.0 section says what else changed,
what to do when upgrading from 0.4.0, and what is knowingly missing; its
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
delete, a save, an action or a change of chosen records; a host page on another origin run in a browser; a run through a real
Cloudflare tunnel; anything that reads what Cloudflare sends at the
examples page's address, which was read by hand once, on 2026-10-16, or
a sign-in to the live demo on Cloudflare, which was read by hand on
2026-10-19
([0088](../decisions/0088-the-demo-image-makes-postgresqls-socket-directory-at-every-start-and-the-gate-runs-it-with-run-empty.md));
a test that logs in as an Entra principal; and a licence a lawyer has
reviewed.
