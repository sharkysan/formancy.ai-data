# 9. Quality requirements

Each requirement here is stated so that it can fail, and names what fails
when it does. Where nothing does, the requirement says so rather than
leaving the reader to assume a gate. A quality goal that nothing checks is a
preference, and this section marks the preferences as such.

## 9.1 Quality tree

```
Formancy Data
├── Fidelity to the database
│   ├── no value rounded, respelled or written back unasked   ← 0008, 0026, 0040
│   ├── one request means the same on both engines            ← 0028
│   ├── what discovery could not see is said, never guessed   ← 0004, 0027
│   └── tested on each image; an untested server is said      ← 0067, 0068
├── Fail closed
│   ├── the policy is asked on every request                  ← 0011, 0022
│   ├── a reference is never a permission                     ← 0012, 0043
│   ├── a published form is checked whenever it is read       ← 0019, 0041
│   └── an ambiguous write is unknown, and never replayed     ← 0015, 0031
├── Governed change
│   ├── drift is classified against what the form rests on    ← 0010
│   ├── a person's choices survive regeneration               ← 0030, 0039
│   └── publication can need a second person                  ← 0065
├── Accessibility and the room
│   ├── every control by role and accessible name, axe clean  ← 0024, 0029
│   └── the same checks in three browsers                     ← 0058
├── Performance
│   ├── rows read and round trips pinned, never a clock       ← 0034
│   └── a lookup stops when it is abandoned or late           ← 0061
├── Operability
│   ├── the guide runs as written from a clean checkout       ← 0032
│   └── the image starts, or says which setting it needs
└── Distribution
    ├── source-available, never Apache-2.0                    ← 0001
    └── upstream depended on at exact versions, never copied  ← 0002
```

## 9.2 Scenarios, with what holds each

### Fidelity to the database

- **Q1. The largest `numeric(18,4)` and a `bigint` past a JavaScript
  number's exact range travel from the database through the API and back.**
  Digit for digit, as strings; a JSON number for a decimal is refused, and
  both renderers accept the largest decimal and refuse one digit more. Held
  by `packages/data-core/src/codecs/codec.test.ts`, both adapters'
  `records.integration.test.ts` and `apps/examples/src/previews.test.tsx`
  ([0008](../decisions/0008-exact-values-travel-as-strings.md)).
- **Q2. A column fact the engines disagree on** -- the unit a text length is
  counted in, a 32-bit float's spelling. Named in the contract and checked
  in the column's own unit, never smoothed over in the core. Held by
  `packages/data-core/src/codecs/codec.test.ts`
  ([0026](../decisions/0026-name-every-column-fact-the-engines-disagree-on.md)).
- **Q3. One row filter, one label and one refusal, asked of both engines.**
  The same rows, the same text, the same code, from one expectation written
  once in `packages/data-fixtures/src/parity.ts`. Held by
  `packages/data-postgres/src/parity.integration.test.ts` and
  `packages/data-sqlserver/src/parity.integration.test.ts`, and by the
  release report, which fails a run in which a shared case passed through one
  adapter only
  ([0028](../decisions/0028-filters-labels-and-refusals-mean-the-same-on-both-engines.md),
  [0035](../decisions/0035-a-release-report-is-derived-from-the-run-that-gated-it.md)).
- **Q4. A restricted account discovers a schema whose constraints and
  referrers it cannot see.** The snapshot carries a gap that says what could
  not be read; "no relationship" is never the answer for "could not tell".
  Held by both adapters' `discovery.integration.test.ts` and
  `discovery-access.integration.test.ts`, and
  `packages/data-core/src/snapshot.test.ts`
  ([0004](../decisions/0004-a-snapshot-says-what-it-could-not-see.md),
  [0006](../decisions/0006-postgres-discovery-reads-pg-catalog.md),
  [0007](../decisions/0007-sqlserver-discovery-and-what-it-hides.md),
  [0027](../decisions/0027-a-snapshot-says-what-its-account-may-do.md),
  [0049](../decisions/0049-a-snapshot-says-whether-its-account-may-delete-and-what-refers-to-each-table.md)).
- **Q5. An instant or a time is read and saved without being edited.** It
  is never written back; one the person changed is written in UTC. Held by
  `apps/host/src/temporal-round-trip.test.ts` on both engines through the
  real server
  ([0040](../decisions/0040-instants-and-times-are-read-to-the-shape-and-an-unedited-one-is-never-written.md)).
- **Q6. The same snapshot and request are generated from twice.** The form,
  its bindings and its notes are byte-identical, on spec 3, and the released
  `@formancy/spec` validator accepts the form. Held by
  `packages/data-core/src/generate/generate.test.ts`
  ([0009](../decisions/0009-generation-is-deterministic-and-says-what-it-chose.md),
  [0042](../decisions/0042-generated-forms-stay-on-spec-3-after-spec-4-is-released.md),
  [0066](../decisions/0066-a-lookup-a-person-can-search-is-generated-as-a-typeahead.md)).
- **Q7. A table keyed by a uuid the database fills is listed and written
  to.** The key is never written by a generated form unless the person
  gives another part of it, and the rows come in each engine's own order of
  uuid, total and stable on each. Held by both adapters'
  `uuid.integration.test.ts`
  ([0056](../decisions/0056-a-key-the-database-fills-is-never-written-and-a-uuid-is-ordered-as-each-engine-orders-it.md),
  [0057](../decisions/0057-a-key-of-one-column-filled-by-a-never-repeating-default-counts-as-numbered.md)).

### Fail closed

- **Q8. A request arrives with no token, a forged tenant, or a role the
  policy does not name.** 401 or 403, and the adapter is never asked. Held
  by `packages/data-server/src/routes/runtime.test.ts`,
  `packages/data-core/src/policy/evaluate.test.ts` and
  `packages/data-identity/src/identity.test.ts`
  ([0011](../decisions/0011-every-operation-carries-a-trusted-policy-context.md),
  [0014](../decisions/0014-host-identity-is-verified-offline.md),
  [0022](../decisions/0022-the-runtime-plane-asks-the-policy-every-time.md)).
- **Q9. A browser submits another tenant's lookup token, or a child row
  under a parent the person may not reference.** Refused by the database's
  membership check before any write. Held by both adapters'
  `lookups.integration.test.ts` and `through.integration.test.ts`, and
  `packages/data-core/src/lookup/token.test.ts`
  ([0012](../decisions/0012-a-lookup-token-is-a-reference-not-a-permission.md),
  [0043](../decisions/0043-a-child-forms-rows-are-reached-only-through-a-parent-its-policy-admits.md)).
- **Q10. A stored version is edited on disk, or a client other than the
  studio publishes a change to the bindings as a layout edit.** Refused on
  publish and on every read: the snapshot must hash to its fingerprint, and
  the base and bindings must be what the generator makes of the request the
  bundle carries. Held by `packages/data-server/src/bundle.test.ts` and
  `packages/data-server/src/routes/admin.test.ts`
  ([0019](../decisions/0019-a-published-form-is-checked-every-time-it-is-read.md),
  [0030](../decisions/0030-presentation-is-a-patch-over-the-generated-base.md)).
- **Q11. The form's own table changes after publication and before anybody
  reviews drift.** The runtime refuses what drift would block, decided over
  a description read in the same request. Held by
  `packages/data-server/src/routes/runtime-drift.integration.test.ts` on both
  engines ([0041](../decisions/0041-the-runtime-refuses-what-drift-blocks.md)).
- **Q12. An update carries a version the record no longer has.** `stale`,
  and nothing is written, in one guarded statement that is never retried.
  Held by both adapters' `records.integration.test.ts`
  ([0015](../decisions/0015-a-record-operation-is-one-guarded-statement.md),
  [0016](../decisions/0016-postgres-operations.md),
  [0017](../decisions/0017-sqlserver-operations.md),
  [0018](../decisions/0018-one-planner-turns-answers-into-requests.md)).
- **Q13. The answer to a write is lost after the database committed it.**
  The host is told the outcome is unknown; nothing here sends it again, and a
  copy the browser sends again is answered with the first answer. Held by
  both adapters' `records-lost-answer.integration.test.ts`,
  `packages/data-server/src/e2e-lost-answer.integration.test.ts`,
  `packages/data-client/src/lost-answer.integration.test.ts`,
  `apps/host/src/in-flight.test.tsx` and the host page's browser gate
  ([0031](../decisions/0031-an-answer-lost-after-a-write-is-unknown.md)).
  Within one server process only: see [§11](11-risks-and-debt.md).
- **Q14. A delete would reach a table through a foreign key the policy does
  not name.** Refused, and nothing is deleted. Held by
  `packages/data-core/src/policy/cascades.test.ts`,
  `packages/data-core/src/records/plan-delete.test.ts` and both adapters'
  `cascade.integration.test.ts` and `delete.integration.test.ts`
  ([0050](../decisions/0050-a-record-is-deleted-one-at-a-time-by-its-token-and-the-version-its-person-read.md),
  [0051](../decisions/0051-a-delete-reaches-other-tables-only-through-foreign-keys-the-policy-names.md)).
- **Q15. A path holds a percent-escape, a backslash or a dot segment that a
  proxy could read differently.** 400 `path-not-plain`, before
  authentication. Held by `packages/data-server/src/app.test.ts`, the
  `container` job and the `cloudflare` job's corpus
  ([0037](../decisions/0037-cloudflare-is-the-edge-not-the-runtime.md)).
- **Q16. A page on an origin the operator did not list calls the runtime
  plane, or any other origin calls the administrator's.** Refused. Held by
  `packages/data-server/src/cors.test.ts` and
  `packages/data-server/src/cross-origin.test.ts`
  ([0060](../decisions/0060-the-runtime-plane-answers-the-origins-an-operator-lists-and-the-administrators-plane-none.md)).
  No browser gate runs against a server with origins listed.
- **Q17. A client writes its own `X-Forwarded-For`.** Believed only from a
  proxy the operator names. Held by
  `packages/data-server/src/trusted-proxies.test.ts`,
  `packages/data-server/src/forwarded.test.ts` and the `container` job
  ([0071](../decisions/0071-the-server-believes-the-forwarded-address-only-from-the-proxies-an-operator-names.md)).
- **Q18. A secret or a token reaches a log, compose's configuration or a
  container's inspect.** The `getting-started` job fails. That holds the
  composed stack only; a deployment's own logging is the operator's
  ([0032](../decisions/0032-a-clean-install-is-the-composed-stack-and-ci-runs-its-guide.md)).
  An audit event never holds a value:
  `packages/data-server/src/routes/runtime.test.ts` and
  `packages/data-server/src/routes/admin-audit.test.ts`
  ([0023](../decisions/0023-the-audit-trail-is-operational-not-evidence.md),
  [0033](../decisions/0033-the-administrator-plane-is-audited.md)).

### Governed change

- **Q19. A column is dropped, retyped or hidden after publication, or a
  grant is revoked.** Drift review classifies each change against the
  form's bindings and lookups as blocking, review or info, and what a gap
  hides is never called gone. Held by
  `packages/data-core/src/drift/diff.test.ts` and
  `packages/data-core/src/drift/compare.test.ts`
  ([0010](../decisions/0010-drift-is-classified-against-the-bindings.md)).
- **Q20. A regeneration gives a field key to another column.** The publish
  is refused until it says what happens to that key's grants. Held by
  `packages/data-server/src/routes/admin-keys-reassigned.integration.test.ts`
  on both engines, through a plain HTTP client and never the studio
  ([0039](../decisions/0039-a-publish-says-what-happens-to-the-grants-of-reassigned-keys.md)).
- **Q21. A person's labels, order, widths and moves meet a regenerated
  base.** Carried by what each field and section stands for, a move that
  cannot be carried dropped and said, and nothing the presentation step
  offers removes, renames or retypes a bound field. Held by
  `packages/data-core/src/presentation/rebase.test.ts` and
  `apps/studio/src/presentation.test.tsx`
  ([0030](../decisions/0030-presentation-is-a-patch-over-the-generated-base.md),
  [0075](../decisions/0075-a-field-may-move-to-another-generated-section.md)).
- **Q22. Two administrators publish from the same version at once.**
  Exactly one wins and the other is told the current version. Held by
  `packages/data-server/src/config-store.test.ts`
  ([0013](../decisions/0013-published-configuration-is-files-with-link-based-swap.md)).
- **Q23. Under review, an administrator approves the draft they
  submitted.** Refused, whatever roles they hold. Held by
  `packages/data-server/src/routes/admin-drafts.test.ts`
  ([0065](../decisions/0065-with-publisher-roles-set-a-draft-is-published-only-when-a-publisher-who-did-not-submit-it-approves-it.md)).
  No gate runs review in the composed stack.
- **Q24. A version file moves to another deployment.** Imported as a
  publish the target's database must be able to serve, or refused. Held by
  `packages/data-server/src/routes/admin-promotion.test.ts` and
  `packages/data-server/src/routes/admin-promotion.integration.test.ts`
  ([0062](../decisions/0062-a-published-version-moves-between-deployments-as-its-version-file.md)).
- **Q25. Before publication, an administrator grants delete over a table
  others refer to.** The studio names who may delete and asks for each
  foreign key a delete acts through, by name. Held by
  `apps/studio/src/delete-reach.test.tsx`
  ([0052](../decisions/0052-the-studio-says-before-publication-who-may-delete-and-what-a-delete-also-does.md)).

### Accessibility and the room

- **Q26. Any state the studio or the host page reaches.** Every control has
  an accessible name, axe reports nothing, and every request is one of its
  plane's routes -- on the host page with the token in its header only.
  Held by
  `apps/studio/src/journey.test.tsx`, `apps/host/src/page.test.tsx` and
  `apps/host/src/plane.test.tsx`, against the real server
  ([0024](../decisions/0024-the-studio-speaks-only-the-admin-plane.md),
  [0029](../decisions/0029-a-host-renders-a-published-form-through-one-client.md),
  [0047](../decisions/0047-a-hosts-workspace-lists-opens-and-edits-records-in-linked-grids.md)).
- **Q27. Each app in Chromium, Firefox and WebKit, down to a phone's
  width.** No sideways scroll, the first Tab on the skip link, axe's
  colour-contrast and target-size rules clean, the paper free of the room's
  rules, and the same checks by name in every browser. Held by
  `apps/examples/scripts/browser-test.mjs`,
  `apps/studio/scripts/browser-test.mjs` and
  `apps/host/scripts/browser-test.mjs`, one `browser` job leg per browser
  ([0021](../decisions/0021-generated-forms-preview-in-both-frameworks.md),
  [0058](../decisions/0058-the-browser-gates-run-in-chromium-firefox-and-webkit-and-each-fact-the-browsers-disagree-on-is-named-and-held.md)).
- **Q28. A person deletes a record on the host page.** Confirmed in place,
  one record at a time, and the page says what the server did. Held by
  `apps/host/src/delete.test.tsx` and `apps/host/src/delete-rows.test.tsx`
  ([0053](../decisions/0053-a-host-deletes-a-record-from-its-detail-or-its-row-after-a-confirmation-in-place.md)).
- **Q29. A stylesheet here declares one of the admin's palette's variables
  again, or an app draws with it without importing it.**
  `scripts/palette.test.mjs` fails, naming the stylesheet and the variable,
  or the app
  ([0096](../decisions/0096-the-apps-wear-formancys-room-css-rather-than-a-copy-of-admin-css.md)).

### Performance

- **Q30. A lookup searches the sized customer table.** The rows the
  database reads and the round trips each request makes are pinned on both
  engines; no time is asserted. Held by
  `packages/data-postgres/src/lookups-sized.integration.test.ts`,
  `packages/data-sqlserver/src/lookups-sized.integration.test.ts` and
  `packages/data-performance/src/harness.integration.test.ts`, against the
  counts in `packages/data-performance/src/catalogue.ts`
  ([0034](../decisions/0034-performance-is-measured-through-the-shipped-server-and-held-without-a-clock.md)).
- **Q31. A browser abandons a search, or its deadline passes.** The
  statement stops in the database, and a late search is 503
  `lookup-timeout`. Held by
  `packages/data-server/src/routes/runtime-lookup-limits.integration.test.ts`
  and each adapter's `lookups-limits.integration.test.ts`
  ([0061](../decisions/0061-a-lookup-statement-stops-when-its-request-is-abandoned-or-its-deadline-passes.md)).
- **Q32. The default lookup deadline, after a re-measurement.**
  `packages/data-performance/src/deadline.test.ts` fails until it equals the
  slowest lookup answer the committed results hold
  ([0063](../decisions/0063-the-default-lookup-deadline-is-outside-the-measured-product.md)).
- **Q33. A release is cut from a product the published figures no longer
  describe.** Not refused. `RELEASING.md`'s step 2b names each difference
  with `scripts/performance-stale.mjs`, and the version's changelog
  section says the figures are an earlier product's, which review alone
  holds; no workflow runs the check, so neither a release nor a pull
  request is held for a re-measurement. `scripts/performance-stale.test.mjs`
  fails when a workflow runs it, and when the command passes a product that
  changed
  ([0034](../decisions/0034-performance-is-measured-through-the-shipped-server-and-held-without-a-clock.md),
  [0084](../decisions/0084-a-release-does-not-wait-for-the-performance-figures-to-be-measured-again.md)).

### Operability

- **Q34. A clean machine with Node and Docker follows
  `docs/getting-started.md`.** Its commands run as written, then the
  journey over HTTP on both engines, with the runner's Compose and with the
  oldest release the guide names. Held by the `getting-started` job
  ([0032](../decisions/0032-a-clean-install-is-the-composed-stack-and-ci-runs-its-guide.md)).
- **Q35. The server image is started with nothing configured.** It refuses
  and names the setting it needs; configured, it serves health and refuses
  an unauthenticated request. Held by the `container` job, and
  `packages/data-server/src/dockerfile.test.ts` for a workspace package the
  image's copy list forgot.
- **Q36. An operator replaces the host identity key set and sends
  SIGHUP.** The new set is read; a bad file leaves the old set in force and
  says so. Held by `packages/data-identity/src/identity-file.test.ts` and the
  `container` job
  ([0059](../decisions/0059-the-host-identity-key-is-a-set-selected-by-kid-and-read-again-on-sighup.md)).
- **Q37. A person asks for the menu of forms.** It names the forms they may
  read and their children, and nothing about the others, asking no
  database. Held by `packages/data-core/src/records/menu.test.ts` and
  `packages/data-server/src/routes/runtime-menu.test.ts`
  ([0045](../decisions/0045-the-runtime-plane-lists-the-forms-a-person-may-read-and-nothing-about-the-others.md)).
  A page of records is held by both adapters'
  `list.integration.test.ts`
  ([0044](../decisions/0044-a-forms-records-are-listed-a-page-at-a-time-under-its-read-policy.md)).

### Distribution

- **Q38. A package manifest says Apache-2.0, or a tarball lacks
  `LICENSE.md` or `NOTICE`.** `node scripts/verify-licenses.mjs` fails, on
  every pull request and before a release
  ([0001](../decisions/0001-a-paid-module-in-its-own-repository.md)).
- **Q39. An upstream `@formancy/*` dependency is a range, a `workspace:`
  link or a path, or the release-age exemption names another package.**
  `scripts/upstream-deps.test.mjs` fails
  ([0002](../decisions/0002-depend-on-upstream-never-copy-it.md),
  [0055](../decisions/0055-an-upstream-release-is-adopted-the-day-it-is-published.md)).
- **Q40. A built app bundles a package.** The licence and notice texts it
  ships are in the app's third-party notices. Held by
  `scripts/third-party-notices.test.mjs`
  ([0046](../decisions/0046-a-built-app-carries-the-licence-and-notice-texts-of-everything-it-bundles.md)).
- **Q41. A document's licence block says other than `LICENSE.md`.**
  `scripts/licence-status.test.mjs` fails
  ([0048](../decisions/0048-the-licence-is-in-force-before-a-lawyer-has-read-it.md),
  [0054](../decisions/0054-version-1-1-names-the-address-for-a-redistribution-agreement-too.md)).
- **Q42. A packed tarball's `exports` map is wrong for a consumer outside
  the workspace.** The `install` job fails
  ([§10](10-verification.md)).

### Server versions

- **Q43. A behaviour passes on one image of an engine's matrix and fails on
  another.** That image's leg of the `test-images` job fails, naming its
  package and image, and the release report fails a run in which a shared
  case is missing or failed on any image of the matrix. What the versions
  of one engine disagree on is a named row of `VERSION_FACTS` in
  `packages/data-fixtures/src/versions.ts`, asserted on each leg by the
  major its server answered and never skipped. Held by
  `scripts/ci-test-jobs.test.mjs`, which fails when the legs and
  `MATRIX_IMAGES` disagree, and by each adapter's
  `server.integration.test.ts`, which fails when a leg's server is another
  image's
  ([0067](../decisions/0067-the-adapter-suites-run-on-every-image-of-a-per-engine-matrix.md)).
  Only the adapter suites and data-fixtures run per image.
- **Q44. A form is made on a server this release was not tested on.** The
  connection test, the studio and drift review, as `server-untested`, say
  so, and nothing refuses it but SQL Server discovery on a release before
  2019, which names its release. Held by
  `packages/data-core/src/server.test.ts`,
  `packages/data-core/src/drift/server.test.ts`, each adapter's
  `server.test.ts`, `packages/data-fixtures/src/images.test.ts`, which holds
  `TESTED_SERVERS` to the matrix, and
  `packages/data-server/src/routes/admin-untested.integration.test.ts`
  ([0068](../decisions/0068-a-snapshot-records-the-server-it-was-read-from-and-nothing-refuses-a-server-discovery-can-read.md)).
  That discovery refuses an older SQL Server before it reads the catalog is
  reached by no test.

## 9.3 Performance is published, not budgeted

There is no latency budget, and no time is asserted anywhere in CI: its
runners are shared, and a timing gate there would be either too loose to
mean anything or flaky
([0034](../decisions/0034-performance-is-measured-through-the-shipped-server-and-held-without-a-clock.md)).
What is held instead is what a clock cannot blur: the rows each lookup reads
and the database round trips each request makes, pinned on both engines in
every run (Q30).

The times themselves are in `docs/performance.md`, rendered from
`docs/performance/results.json` by `@formancy/data-performance` and held to
it by `scripts/performance-doc.test.mjs`. Beside every figure that page names
the machine, the database's size, the network path and the date it was
measured; nothing in it is typed, and this section copies none of it, so
that a re-measurement cannot leave a stale copy here. Release gate 11 names
that page as its evidence, so every release report shows it as stated and
never as passed in the run
([0035](../decisions/0035-a-release-report-is-derived-from-the-run-that-gated-it.md)).

What the figures do not cover is listed on that page and in the register
([§11](11-risks-and-debt.md)): a page of records, the menu of forms and a
delete are not measured; one machine, loopback, no TLS; and a latency
regression that changes neither the rows read nor the round trips is found
only by the next measurement.

## 9.4 Qualities deliberately not pursued

Stated because an unstated non-goal reads as an oversight:

- **More than one server instance.** The file configuration store serves one
  instance
  ([0013](../decisions/0013-published-configuration-is-files-with-link-based-swap.md));
  a write id holds in one process
  ([0031](../decisions/0031-an-answer-lost-after-a-write-is-unknown.md));
  and each instance reads its key set on its own signal
  ([0059](../decisions/0059-the-host-identity-key-is-a-set-selected-by-kid-and-read-again-on-sighup.md)).
- **An audit trail that is evidence.** It is operational, written after the
  database commits, by another system
  ([0023](../decisions/0023-the-audit-trail-is-operational-not-evidence.md)).
- **A production composed stack.** `compose.yaml` is a clean install to try
  the module on, with no TLS, one replica and SQL Server's Developer edition
  ([0032](../decisions/0032-a-clean-install-is-the-composed-stack-and-ci-runs-its-guide.md)).
- **Localised server sentences.** The server answers in English with a
  stable code; a host that shows another language maps the codes
  ([0029](../decisions/0029-a-host-renders-a-published-form-through-one-client.md)).
- **A manual accessibility audit.** Automated checking in jsdom and in three
  browsers is a floor; nothing in this repository records a run of the apps
  with assistive technology, and nothing here claims more.
- **A regulatory claim.** The IEC 62304 documentation lives in formancy.ai
  and describes that software. This repository claims none; if it ever does,
  the claim is a decision record first.
