# 0128 — The grids of an open form share a person's own views

- **Status:** accepted; amends [0126](0126-a-person-keeps-their-own-list-views-on-the-server-for-themselves-alone.md): a view saved or removed in one grid of the open form is offered, or no longer offered, in every grid of that form at once, where 0126 left each grid its own until the form was opened again
- **Date:** 2026-11-03
- **Deciders:** Daniel Bacher
- **Verified by:** `apps/host/src/use-own-views.test.tsx`, without a
  server -- what one grid's save or remove answered is shown by every grid
  of the form, and by no grid of another form (watched failing with each
  grid keeping its own: the second grid still offered the view list from
  before the save); a grid drawn after the save from a definition read
  before it shows the answer (watched failing with the definition taken
  over the answer: the saved view was missing); a refusal changes nothing,
  and outside a scope a grid keeps its own.
  `apps/host/src/view-picker.test.tsx`, on both engines against the real
  server -- a view saved in the employee form's Records panel is offered
  at once in the Employee section under an employee, the form as its own
  child, and removed there is offered in the Records panel no more.

## Context

0126 lets a person save the filter and sort a grid shows as a view of
their own, which the server keeps and `GET /v1/forms/:id` offers back. On
the host page each grid held the views its form's definition offered when
it was drawn, and what its own saves and removes answered. One form is
often listed in more than one grid at once: an employee form in its
Records panel and under an employee as its own child, an order form under
an employee twice, through who created and who approved it, and every
level of Drill down. A view saved in one of them was missing from the
others until the form was opened again, and one removed there was still
offered, to be refused as gone.

## Decision

**The grids of one open form share what the server answered**
(`OwnViewsScope`, `useOwnViews`, `apps/host/src/use-own-views.ts`). The
workspace draws one scope around the open form, keyed by the form, so
every grid inside it -- the Records panel, each child section, each level
of Drill down -- reads a form's own views from the same place: what the
server last answered a save or a remove of that form with, in any of
them, which is the server's whole list as it then stood. Before any
answer, a grid shows what its definition offered.

**An answer beats a definition.** A child section is drawn from a
definition read when the form was opened; drawn after a save, it shows
the save's answer, not the list from before it.

**Opening a form again starts again.** The scope is the open form's, so a
view saved or removed in another page is offered, or not, once this page
opens the form again, as 0126 had it.

## Consequences

**What it buys.** A person who keeps a view in one grid finds it in every
grid of the form on the page, and a view removed anywhere is offered
nowhere.

**What it costs.**
- A view saved or removed in another page reaches this one only when the
  form is opened again here.

**What it forecloses.** Nothing.

## Alternatives considered

**Ask the server again after every save.** A request for every grid of
the form, to learn what the save's answer already said.

**One store for the whole sign-in.** It would outlive the form, and a
form opened again would draw from what this page heard rather than from
the server's answer to its opening.
