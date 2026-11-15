# Status

Which release Formancy Data is at, what that release added, where `main`'s
changes since are listed, and what is not yet measured or read by hand. [The
README](../../README.md#status) gives the short version.

**Status: 0.3.0, the third release.** Over 0.2.0 it adds the host
token's verifier as a package of its own, `@formancy/data-identity`,
which a product that verifies the same tokens installs without the
server, Fastify or a driver
([0091](../decisions/0091-the-host-identity-verifier-is-a-package-of-its-own-which-the-server-re-exports.md));
a host page that drills down one level at a time, with a trail back
([0090](../decisions/0090-a-hosts-workspace-can-drill-down-one-level-at-a-time-with-a-trail-back.md));
and a release SBOM of what a consumer's install brings, held to that
install
([0092](../decisions/0092-the-sbom-describes-what-a-consumer-installs-and-is-held-to-that-install.md)).
[`CHANGELOG.md`](../../CHANGELOG.md)'s 0.3.0 section says what else changed,
what to do when upgrading from 0.2.0, and what is knowingly missing; its
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
-- and any for a page of records, a file of them, the menu of forms or a
delete; a host page on another origin run in a browser; a run through a real
Cloudflare tunnel; anything that reads what Cloudflare sends at the
examples page's address, which was read by hand once, on 2026-10-16, or
a sign-in to the live demo on Cloudflare, which was read by hand on
2026-10-19, its start answering after 1778 ms
([0088](../decisions/0088-the-demo-image-makes-postgresqls-socket-directory-at-every-start-and-the-gate-runs-it-with-run-empty.md));
a test that logs in as an Entra principal; and a licence a lawyer has
reviewed.
