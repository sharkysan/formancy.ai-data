# Contributing

Thank you for looking. Three things to know before you spend any time.

## This is source-available, not open source

Formancy Data is distributed under the
[Formancy Data Source-Available Licence](LICENSE.md): free to read, fork,
evaluate, develop and test, including inside a company; a paid licence to run
in production. The formancy engine, renderers, builder and backend it builds on
are Apache-2.0 and stay that way; this module is not, and
[0001](docs/decisions/0001-a-paid-module-in-its-own-repository.md) says why.

If you were looking for the open-source form platform, it is
[formancy.ai](https://github.com/sharkysan/formancy.ai).

## Contributions are taken under a CLA

Before a pull request from outside the project can be merged, you sign a
Contributor License Agreement. It asks for a copyright licence broad enough to
sublicense, an express patent licence, and your statement that you have the
right to grant them.

It does **not** ask you to assign copyright. You keep ownership of your work;
what the project gains is permission.

**Why, plainly.** The project distributes this software under its own licence
and under commercial agreements. A contribution that arrived under no terms at
all could not be distributed that way, and the option cannot be reopened after
the fact. That is a real trade and you may not like it; better that you read it
here than discover it later.

### How to sign

[`CLA.md`](CLA.md) is the agreement. Signing it is a commit in this repository,
under your own git identity, adding yourself to
[`.github/cla/signatories.json`](.github/cla/signatories.json) — the hash of
the terms you agreed to goes in beside your name, so the signature says what was
signed. The steps are in `CLA.md` under *How to sign*; there is no form and no
third-party service.

`.github/workflows/cla.yml` runs on every pull request and names any commit
author it has no signature for. It reads commit **authors**, so list every
address you commit from.

## How work is done here

[`CLAUDE.md`](CLAUDE.md) is the working guide — for a person as much as for a
coding agent. The short version: test-first with the failure observed, every
database behaviour proved on both engines against real servers, every decision
somebody could undo written down with what verifies it, and the documents
updated in the same pull request as the code.
