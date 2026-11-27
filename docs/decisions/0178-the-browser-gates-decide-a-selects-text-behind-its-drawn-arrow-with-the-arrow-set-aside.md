# 0178 — The browser gates decide a select's text behind its drawn arrow with the arrow set aside, where the arrow lies clear of the text

- **Status:** accepted; extends
  [0058](0058-the-browser-gates-run-in-chromium-firefox-and-webkit-and-each-fact-the-browsers-disagree-on-is-named-and-held.md):
  a fact the three browsers agree on, and a gate's rule rests on, is
  checked by every gate in every browser under one name; narrows
  [0085](0085-a-lookup-says-when-its-list-goes-on-never-how-long-it-is.md):
  a select outside the open list whose contrast axe leaves undecided
  behind its drawn arrow is decided by this rule, not failed, in the check
  that every text axe could not decide lies under the list
- **Date:** 2026-11-27
- **Deciders:** Daniel Bacher
- **Verified by:**
  - `scripts/gradient-contrast.test.mjs`, in `pnpm test:repo`: the rule is
    for a text axe gave the gradient alone as its reason, read from axe's
    message key and not its sentence; a computed background's lists split
    at the commas outside a gradient or a `calc()`; lengths, percentages
    and their sums read as the browsers serialize them, and an `em`, a
    product or a nested function not read; `right 18px` the same place as
    `calc(100% - 18px)`; an element's boxes from its computed size, borders
    and padding, whichever box its width sizes; Blueprint's arrow at
    columns 116 to 126 of a 140-pixel select, as the browsers drew it, with
    Firefox's and WebKit's lists given once for two images and with the
    rule's mirror for the other reading order; clear of the text both ways
    and at 60 pixels wide; over it, and said, with the room for it taken
    away, as 0.13.0's #345 took it; over it within a pixel; and never
    decided for an image that is not a gradient, one that repeats, one
    fixed to the window, an origin, a size or a position it does not read,
    or a gradient with no size of its own, which fills its box. Watched
    failing on 2026-11-27 with CSS's repetition of a background's lists
    taken out ("expected undefined to deeply equal [ Array(2) ]") and with
    the pixel's margin dropped ("expected false to be true"), each put back.
  - The three browser gates, `pnpm test:browser`, which the `browser` job
    of `.github/workflows/gates.yml` runs once per browser on every pull
    request and before every release:
    `apps/examples/scripts/browser-test.mjs`' "clean, and decided the
    contrast of every text" and "after a failed submit, and decided the
    contrast of every text", `apps/studio/scripts/browser/measure.mjs`'
    and `apps/host/scripts/browser-test.mjs`' "*state*: the contrast of
    every text decided", and `apps/host/scripts/browser/more.mjs`' "a list
    that goes on (*renderer*): every text on the paper whose contrast axe
    left undecided lies under the open list" each fail a select the rule
    leaves undecided or measures below what axe asks; and each gate, once
    per browser, makes "a select draws its chosen text inside its content
    box, as 0178’s rule for its arrow takes it", `selectTextClipped`'s
    probe. Watched failing on 2026-11-27 in the examples gate, in Chromium
    153.0.8010.12 on Windows 11, at every width and in both states: with
    the select's end padding taken away (`padding-inline-end: 0.625rem`
    put in `app.css`), "a gradient over the box its text is drawn in:
    218,19 to 223,24 and 223,19 to 228,24, the text's 11,9 to 231,33" for
    both panes' Status; with its text `#9aa5b1`, "its gradients clear of
    its text, at 2.5:1, below the 4.5:1 it asks", while "clean, axe finds
    nothing at WCAG 2.2 AA" passed; and with the probe's content box
    measured 20 pixels short of its end, "read ltr, it drew 104 pixels of
    its text past its content box; read rtl, it drew 104 pixels of its
    text past its content box"; each put back. The examples gate then
    passed in Chromium 153.0.8010.12 and Firefox 155.0 on Windows 11; the
    studio's and the host page's gates, and WebKit, are CI's.

  **Held by review alone:** that axe's colours, its stack and its
  compositing, once the select's images are set aside, are what a person
  sees under the text -- they are axe's, as for every other text the gates
  decide; and that no page reacts to the select's `style` attribute
  changing for the moment axe takes.

## Context

formancy 0.14.0's Blueprint draws a plain select's arrow (its #345 and
#346): `select:not([multiple])` takes the platform's appearance off, keeps
`padding-inline-end: 2.25rem` for the arrow, and draws it as two
`linear-gradient`s of the muted ink, each 5 pixels square, placed `right
1.125rem` and `right 0.8125rem` from the padding box's edge, with a
`:dir(rtl)` rule that places them from the left. Before 0.14.0 the rule
every control shares outweighed it, and its `background` took the arrow
away (#345): the select had no background image.

axe-core's colour-contrast cannot place a text over a background image.
When any element under the text has one, it leaves the text undecided with
"Element's background color could not be determined due to a background
gradient", its message key `bgGradient`, wherever the image is drawn. Every
gate's rule is that the contrast of every text is decided, and what axe
cannot decide is measured by a rule of the gate's own or fails
([0021](0021-generated-forms-preview-in-both-frameworks.md),
[0047](0047-a-hosts-workspace-lists-opens-and-edits-records-in-linked-grids.md)).
So on the pull request that moved every `@formancy/*` dependency to
0.14.0, CI's run 45993619213 failed every select on a paper in all three
browsers: the examples page's order Status, in both panes, at every width
and in both states; the studio's Preview after a failed submit; and the
host page's order Status with a row open side by side, in WebKit. axe gave
the same reason in each browser. The other gates' runs in that job were cut
short when turbo stopped the job's other tasks as the examples gate
failed, so what they would have found past that point was not seen.

What was measured on 2026-11-27, on a probe page with Blueprint's rule
copied onto selects 140 pixels wide, a label too long for one, in Chromium
153 and Firefox 155 on Windows 11, and in the WebKit build 2370 that
Playwright installs on Windows, which is another port than the gates'
Linux WebKit and was read for information alone:

- `getComputedStyle` gave `background-position-x` as `calc(100% - 18px),
  calc(100% - 13px)` in all three; Chromium gave every other list once per
  image, Firefox the repeat and the origin once, WebKit those and the size
  once, which CSS repeats for each image.
- Each browser drew the select's text inside its content box and clipped
  it there: the long label's ink ended at column 102 of a content box that
  ends at 103, in all three, though WebKit computes `overflow: visible` for
  a select and the other two `overflow: clip`, which clips at the padding
  box and not the content box. So the computed overflow does not say where
  the text is cut; what is drawn does.
- The arrow's ink lay within columns 116 to 125 of the 140 in Chromium and
  Firefox, inside the 116 to 126 its computed size and position give.
- Two screenshots of a select that differed only in its images, or only in
  its text's colour, differed elsewhere too: in Chromium, the text's colour
  changed, by one or two levels at the rounded border's antialiasing; in
  WebKit, the images taken off, by more than four levels along the border,
  so that WebKit's arrow could not be told from the border by its pixels.
  A rule read from such pixels would need a threshold of its own.

## Decision

**The narrowest rule that decides it, in one module the three gates
share**, `scripts/gradient-contrast.mjs`. A text axe left undecided is
decided by it only when:

- axe's reason is the background gradient and nothing else, by its
  message key;
- its element is a select drawn as one box, neither `multiple` nor of a
  `size` past 1;
- every layer of the select's own computed `background-image` is a
  gradient, or `none`, drawn once (`no-repeat`), scrolling with the
  element, with a size and a position the module reads -- px, percentages
  and their sums, `auto`, `cover` and `contain`, and positions from an
  edge -- in its padding, border or content box;
- and each layer, placed by that size, position and origin in the
  select's own boxes, which are read from its computed width, height,
  `box-sizing`, borders and padding and so are untouched by any
  transform, lies at least a pixel clear of its content box.

Then the select is asked of axe's colour-contrast again, alone, with
`background-image: none !important` in its `style` attribute, which is put
back exactly as it was: the gradients paint nowhere the text is, so axe
measures what is under the text, with its own stack, compositing and
threshold for the text's size. A pass is decided; a violation fails, with
axe's ratio and the one it asks; and anything axe still cannot decide
fails with axe's reason. Anything the rule is not for is left to the
gate's own deciders, or fails as before.

**What it rests on is measured in every browser.** That a select draws
its chosen text inside its content box is the browsers' to say, so
`selectTextClipped` asks the browser the gate runs, on a page of its own:
two selects, black on white, padded at their end as Blueprint pads one,
their label far past the box, one read each way; the ink of each, read
from a screenshot the page decodes, must lie within a pixel of the content
box, inside it, and reach within 12 pixels of its end. Each gate makes
that check once per browser, under one name, so a browser that stops
clipping turns its leg red by name. The three agree, so it is no row of
0058's `FACTS`; a browser that disagreed would make it one.

**The audits keep what axe left undecided**, as axe answered, in
`window.formancyGateUndecided`, as the host's always had, with each node's
index, reason and message keys, and the rule reads them before the next
audit replaces them: the examples page's audit, the studio's `measured`
before it tries a browse's grid, the host page's `decide` before its grids
and panes, and the open list's state for the texts outside the list.

## Consequences

**What it buys.** The gates hold 0.14.0's selects to AA as they held the
selects before it, in all three browsers, and say why when they cannot. A
select's text under AA, which axe's own audit cannot see behind the
gradient and so lets pass as nothing found, fails by name: watched with
the Status's text at 2.5:1 while "axe finds nothing" passed. One rule
decides it for three gates, so the three cannot disagree.

**What it costs.**

- **The arrow itself is measured by nothing.** A muted triangle is a
  graphic that says the box opens a list; its contrast against the field
  is WCAG's non-text contrast, which axe does not measure and no gate does,
  as nothing measured the platform's arrow before 0.14.0.
- **A theme's arrow drawn another way stays undecided.** An image, a
  repeated gradient, a size in `em`, an arrow over the text: each leaves
  its select undecided, and every gate red, until somebody reads it and
  either the theme or this rule changes. That is the point, and it falls
  on whoever moves the theme.
- **The probe is the browser's, not each select's.** It measures a select
  of its own, not every select the rule decides; a select whose own styles
  let its text past its content box in some browser would be decided by a
  clip the probe never saw. Blueprint's do not, and the probe's select is
  padded as Blueprint pads one.
- **An axe release can switch the rule off.** It is keyed on axe's
  `bgGradient`; a release that renames it, or reports the select another
  way, leaves the rule deciding nothing, and the gates fail closed until
  the key is read again.
- **The select is measured with its style attribute changed** for as long
  as axe takes. A page that reacted to that would be measured in a state a
  person never reaches; none of the three does.
- **One more path in the lint configuration.** The module runs code in a
  page, so `eslint.config.mjs` names it among the `browser` files with
  `scripts/browser-gate.mjs`, beside the paths 0116 listed.

## Alternatives considered

- **Pass or skip what axe leaves undecided for a gradient**, or switch the
  rule off for selects. That is the contrast nobody measured, which every
  gate exists to refuse; a text colour under AA behind the arrow would
  pass, as the planted 2.5:1 showed axe's own audit lets it.
- **Read the pixels**: a screenshot of the select with and without its
  images, the arrow where they differ, the text where it is drawn. The
  pixels differ elsewhere too, by one or two levels in Chromium and by
  more in WebKit, so it needs a threshold, and a select scrolled out of
  view must first be scrolled into it, which changes the state the host
  gate measures. The geometry is exact and needs neither; the pixels are
  kept for what geometry cannot know, where a browser clips the text.
- **Compute the contrast here**: the text's colour against the select's
  background colour, composited over what is behind it, at 4.5:1 or 3:1
  by size. That is a second implementation of axe's stack, compositing and
  large-text rule, which would disagree with axe's somewhere and be found
  by nobody. Set aside, the gradients leave axe nothing it cannot decide.
- **Every element with a gradient**, not only a select. A text in another
  element can run past its content box, which no probe here measured; the
  rule would decide texts it cannot see.
- **The arrow drawn another way upstream**, as a pseudo-element or a mask.
  axe leaves a text over a pseudo-element undecided too ("could not be
  determined due to a pseudo element", as inside the host's grids, 0047),
  and a mask on the select would cut its text. How formancy's theme draws
  its arrow is formancy's; a gate here measures what it draws.
- **A rule in each gate**, as the host's grids have their own. Three
  copies of one decision, where "if these two ever disagree, would anybody
  find out?" answers no.
