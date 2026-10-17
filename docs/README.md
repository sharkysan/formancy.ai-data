# Formancy Data — architecture and decision documentation

Engineering documentation for the people who need to understand *why*
Formancy Data is built the way it is: contributors, integrators, and
customers evaluating a module whose source is public and whose production
use is licensed. It is source-available, never open source, and
[the README's licence table](../README.md#licence-in-one-table) says what
that means.

It is not the user documentation. How to use the module is in
[the README](../README.md), each package's own README, and
[the getting-started guide](getting-started.md), which CI runs as written.
How work is done here, and the bar a change meets, is
[`CLAUDE.md`](../CLAUDE.md). Nothing here is a tutorial.

## Start here

| If you are… | Read |
|---|---|
| New to the codebase | [Introduction and goals](architecture/01-introduction-and-goals.md), then [Solution strategy](architecture/04-solution-strategy.md) — the ideas everything else follows from |
| Looking for where something lives | [Building blocks](architecture/05-building-blocks.md) |
| Following a form from a catalog to a person's record | [Runtime view](architecture/06-runtime-view.md) |
| Wondering why an obvious simpler thing was not done | [Decision records](decisions/README.md) and their index |
| Deploying or operating the server | [Deployment view](architecture/07-deployment-view.md), then [Risks and technical debt](architecture/11-risks-and-debt.md) and [the known limitations](release/limitations.json) |
| About to change something load-bearing | [Verification](architecture/10-verification.md), [Risks and technical debt](architecture/11-risks-and-debt.md) and the record behind it |

## Architecture

Structured as [arc42](https://arc42.org), as formancy.ai's is, because it is
a recognised shape and a reader who knows it can find things without being
told
([0076](decisions/0076-the-architecture-is-documented-as-arc42-and-every-change-updates-the-section-it-touches.md)).

| | |
|---|---|
| [1. Introduction and goals](architecture/01-introduction-and-goals.md) | What Formancy Data is, the problems it fixes, and the quality goals in the order this document gives them |
| [2. Constraints](architecture/02-constraints.md) | What was not chosen, and what several decisions look arbitrary without |
| [3. Context and scope](architecture/03-context-and-scope.md) | The system boundary, the parties across it, and what stays outside |
| [4. Solution strategy](architecture/04-solution-strategy.md) | One path from a catalog to a record and back to review, and the ideas the rest follows from |
| [5. Building blocks](architecture/05-building-blocks.md) | Every package and app, what each may import, and what is inside each |
| [6. Runtime view](architecture/06-runtime-view.md) | Discovery, generation, publication alone and under review, the menu, a page of records, a save, a delete, a lookup, drift |
| [7. Deployment view](architecture/07-deployment-view.md) | What is built and released, the composed stack, Cloudflare as the edge, the examples page, the live demo, every setting, and what an operator needs to know |
| [8. Cross-cutting concepts](architecture/08-crosscutting-concepts.md) | Exact values, fail closed, identifiers and bound values, secrets, identity and policy, concurrency, audit, errors, the user interface, licences, upstream |
| [9. Quality requirements](architecture/09-quality-requirements.md) | Scenarios stated so that each can fail, each naming what fails |
| [10. Verification](architecture/10-verification.md) | Real servers on both engines, the gates, what each proves, and what none of them sees |
| [11. Risks and technical debt](architecture/11-risks-and-debt.md) | The riskiest pieces, the known limitations by area, the open release gates, and the accepted risks |
| [12. Glossary](architecture/12-glossary.md) | Terms that mean something specific here, and words used for more than one thing |

`scripts/architecture.test.mjs`, in `pnpm test:repo`, fails when a section
file or this entry is missing, when a workspace package or app is not named
in [the building blocks](architecture/05-building-blocks.md), when a
decision record is cited by no section, when a relative link here, in a
section or in [the setup guide](setup.md) does not reach a file or a
heading GitHub would give it, and when
a repository path a section writes in backticks names nothing in the
repository. Whether a sentence is still true of what it names is held by
review.

## Decisions

The records in [`decisions/`](decisions/README.md) are numbered in the order
they were made, and the index there gives each one's status. Every record
carries a **Verified by** line naming the test or gate that fails when the
decision is violated, or says plainly what nothing checks.

A record that rests on one of formancy.ai's cites it as `formancy.ai NNNN`,
with a link, and does not restate it. These documents do the same.

## Other documents

| | |
|---|---|
| [Getting started](getting-started.md) | From an empty machine with Docker and git to a published form on both engines; CI runs it as written |
| [Setting it up](setup.md) | What is set up outside the repository's files -- GitHub's settings and secrets, the image's visibility, Cloudflare's plan and Workers -- in order, who does each step, and what was found done |
| [Deploying behind Cloudflare](deploy/cloudflare.md) | The composed stack behind a Cloudflare Tunnel and Access, what Cloudflare cannot do here, and what nobody has measured |
| [Performance](performance.md) | What each measured request costs through the shipped server on both engines, rendered from [the committed results](performance/results.json) with the machine, the size and the date |
| [The release report](release/README.md) | What every run of the gates reports about itself, what fails it, and what a release does with it |
| [`gates.json`](release/gates.json) | The release gates, each with the evidence a run must pass or the reason it is open |
| [`limitations.json`](release/limitations.json) | For every decision record, the costs a user, integrator or operator meets, or why it has none |
| [The README's pictures](images/README.md) | How they are taken, what holds them, and what they show that is wrong |

The delivery plan this repository started from is a working document kept
out of the repository, as `.gitignore` says; what it asked for became the
decision records, and its release gates are numbered in `gates.json` as it
numbered them.
