# 0124 — A list view may be offered to some roles, and open their grids

- **Status:** accepted; extends [0105](0105-a-forms-list-offers-views-its-administrator-named.md): a view may name the roles it is offered to, a default holds for those roles, and a person is offered only the views for one of theirs and those for everyone; amended by [0125](0125-a-list-view-may-count-days-from-today-and-compare-with-the-signed-in-persons-attribute.md): a view relative to whoever is signed in is offered
- **Date:** 2026-11-01
- **Deciders:** Daniel Bacher
- **Verified by:** `packages/data-core/src/presentation/views.test.ts` --
  a view's roles are a list of roles, each once, never empty, and a default
  holds for its view's roles, so views for other roles may each be one
  while two for everyone are refused (watched failing with roles read as
  an unknown property: the views were refused); a person is offered the
  views for their roles and those for everyone, without the roles, and a
  grid opens on the first default among them (watched failing with every
  view offered whatever its roles: the managers' view reached the clerk);
  a regeneration carries a view's roles (watched failing with the roles
  left out of the carried view).
  `packages/data-server/src/routes/runtime-lists.test.ts`, over fake ports
  -- the form offers a clerk the view for clerks, as their default, and not
  the managers' (watched failing with the published views offered whatever
  their roles). `apps/studio/src/list-views.test.tsx` -- a view given roles
  in its form says them in its words and publishes with them (watched
  failing with the roles left out of the saved view).

## Context

0105 lets a form's administrator name list views, offered to every person
who could have built them from their own list, with one view the grid
opens on. A form used by clerks and managers offered them the same views
and the same opening view, though a clerk's work and a manager's start from
different records.

## Decision

**A view may name the roles it is offered to** (`roles`), each once, never
none: left out, it is offered to everyone who could have built it, as
before. A person is offered the views for one of their roles and those for
everyone, in their published order, each still fitted to what their own
list offers (0105) (`viewsFor`, `packages/data-core/src/presentation/views.ts`).

**A default holds for its view's roles.** At most one default may be
offered to everyone; views for some roles may each be one. A person
offered more than one -- two roles, a default each, or one for them and
one for everyone -- opens on the first in the published order, which the
server sends as the only default (`listColumns`).

**The roles stay the administrator's.** The server sends a person their
views without the roles, so the page draws nothing new and
`@formancy/data-client` reads the list as before.

**The studio edits them** in the view's form: "Offered to roles, empty for
everyone", in the policy's roles box, and the view's words end "for
clerk, manager".

## Consequences

**What it buys.** Each role's people pick from their own views, and their
grids open where their work starts.

**What it costs.**
- A view is offered by role, not by person: a view "mine", relative to
  whoever is signed in, is a later change.
- A person who holds two roles with a default each opens on the first in
  the published order; nothing else decides between them.
- A role is a name the host's token carries: a role misspelt here offers
  the view to nobody, and nothing checks it against the policy's roles.
- A server of an earlier release refuses a version whose views name
  roles, as `roles is not a property of a list view`.

**What it forecloses.** Nothing.

## Alternatives considered

**Views per role in the policy.** Which views a person picks is how the
list is presented to them, not what they may read: a view for the
managers, picked by a clerk who could have built it, would show nothing
the clerk may not see.

**Send the roles and let the page choose.** A page would know which views
the administrator made for others, and the choice would be made twice.
