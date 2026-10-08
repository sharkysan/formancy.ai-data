# Security Policy

## Reporting a vulnerability

Please report security vulnerabilities through GitHub Security Advisories
("Report a vulnerability" on the Security tab) rather than a public issue.

We aim to acknowledge a report within 3 working days and to provide a
remediation timeline within 10 working days.

Please do not include a working exploit in the initial report; a description of
the vulnerability class and the affected component is enough to begin triage.

## Scope

Formancy Data connects to a customer's existing database and writes to it.
That makes it a higher-risk component than a form renderer, and the areas we
consider highest risk, and are most interested in reports about, follow from
it:

- **SQL injection** through identifiers — a schema, table or column name that
  reaches a query without having come from approved metadata and been quoted by
  the adapter — or through a value that was interpolated rather than bound.
- **Authorisation bypass** on record read, lookup, create or update: a
  hidden or disabled control treated as a permission, a field accepted that the
  policy did not list, a tenant filter that a request could influence.
- **Cross-tenant reference** through a lookup: a foreign-key value that names a
  record the actor may not see, accepted because the record exists.
- **Metadata disclosure**: a discovery or error path that reveals schema,
  constraint or row information the connection's policy does not permit.
- **Secret exposure**: a connection string or credential in a log line, an
  error message, an API response or a published bundle.
- **Lost update or silent overwrite**: a write that proceeds without the
  expected version, or an ambiguous write replayed automatically.

Nothing in the packages fetches a URL, and no form document ever carries one;
a report that found a way to make the module reach the network on an outsider's
instruction is in scope and serious.
