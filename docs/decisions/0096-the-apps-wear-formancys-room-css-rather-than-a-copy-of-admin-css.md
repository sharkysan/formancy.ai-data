# 0096 — The apps wear formancy's `room.css` rather than a copy of `admin.css`

- **Status:** accepted; reverses [0024](0024-the-studio-speaks-only-the-admin-plane.md)'s copy of the admin's palette; narrows [0072](0072-the-apps-serve-their-own-fonts-and-no-page-asks-another-host-for-anything.md): `--display` is read from `room.css`
- **Date:** 2026-10-22
- **Deciders:** Daniel Bacher
- **Verified by:** `scripts/palette.test.mjs`, in `pnpm test:repo`, over
  `@formancy/themes/room.css` as `apps/host` resolves it. *Is read from the
  formancy release this repository pins, and worn by the apps* -- `room.css`
  declares `--ground`, `--text`, `--muted`, `--client` and `--server`, and
  the apps whose own stylesheets read one of its variables, derived, include
  the examples page, the studio and the host page. *Is imported by every app
  that draws with it, before its own stylesheet* (watched failing before this
  record: none of the three imported it). *Is declared by no stylesheet of
  any app* (watched failing before this record with all twelve of its
  variables in each of the three copies). `scripts/no-other-host.test.mjs`,
  *every stack the room and Blueprint draw with has a face in the build*,
  reads `--display` from `room.css` and `--sans` and `--mono` from the app's
  own stylesheet. The browser gates, in Chromium, Firefox and WebKit, measure
  every state's colour contrast with axe against the built page, which is
  where a palette that did not arrive would show. **Not mechanically
  enforced:** that a picture in the README looks as it did; its record's
  stylesheet digest moves with this change, and the pictures were taken
  again (0038).

## Context

CLAUDE.md asks each UI here to wear formancy.ai's admin palette: a dark
bench, glass panels, violet for what the person acts on and teal for what the
server did. Until formancy 0.6.0 an application's stylesheet was not a
package, so each app copied `apps/admin/src/admin.css`'s variables into its
own stylesheet -- the examples page's `app.css`, then the studio's and the
host page's `styles/room.css` -- and `scripts/palette.test.mjs` held the
three copies to each other. Nothing held them to upstream's: 0024 named that
as a cost, and CLAUDE.md listed it under what nothing holds.

formancy 0.6.0 publishes the palette as `@formancy/themes/room.css`, the file
its admin imports itself (formancy.ai 0178): the twelve variables, the
`--wb-*` that recolour `workbench.css`, and `color-scheme: dark`, on `:root`,
and nothing else. Compared on 2026-10-22, its twelve values are the copies'
own, character for character.

Depending on upstream rather than copying it is this repository's first rule
([0002](0002-depend-on-upstream-never-copy-it.md)).

## Decision

- **Every app imports `@formancy/themes/room.css` from its entry**,
  `src/main.tsx`, after the Blueprint theme and before its own stylesheet, as
  it imports the theme and its faces (0072). The palette is the release of
  `@formancy/themes` this repository pins.
- **No stylesheet here declares one of its variables.** Each app keeps on its
  own `:root` only what `room.css` does not carry: `--sans` and `--mono`, the
  two stacks the admin reads from `workbench.css`.
- **The palette guard holds both**, deriving the apps from the stylesheets
  that read the palette, and the variables from `room.css` as installed.

## Alternatives

- **Keep the copies.** Each upstream move of the palette is then three hand
  edits nothing reminds anybody to make.
- **Import `room.css` from each app's stylesheet** with `@import`. The
  browser gates and the picture camera inline only an app's own relative
  imports, and refuse any other, so each would have to resolve a package; the
  entry already imports the theme and the faces that way.

## Consequences

**What it buys.** The room is upstream's, at the release pinned here: a
palette change upstream reaches every app with the bump that brings it, and
cannot be half-applied.

**What it costs.**

- **A palette change arrives with a version bump**, where a copy made it a
  separate edit. The browser gates' contrast checks are what read its effect.
- **The studio's `:root` now carries `--wb-*`**, which `room.css` sets for
  `workbench.css`. The studio loads no `workbench.css` (0024), so they
  recolour nothing; they are there.
- **The README's pictures were taken again**, because each record's
  stylesheet digest covers the app's stylesheet with its imports and that
  text changed; what they show did not, since every variable computes to the
  value the copy gave it.
