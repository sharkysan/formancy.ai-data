import { describe, expect, test } from 'vitest'
import { boxesOf, gradientLayers, gradientProblem, linear, MARGIN, onGradientAlone, over, position, splitTop } from './gradient-contrast.mjs'

/**
 * 0178's rule for a text axe leaves undecided behind a select's drawn
 * arrow, in the parts that need no browser: which nodes it is for, how a
 * computed background is read into the boxes its layers paint, and when
 * one lies over the box the text is drawn in. What axe says once the
 * gradients are set aside, and whether a browser clips a select's text to
 * its content box, are measured in each browser by the gates.
 */

/**
 * Blueprint's plain select in formancy 0.14.0, as getComputedStyle read it
 * on 2026-11-27 in Chromium 153 and Firefox 155 on Windows, and in the
 * WebKit of Playwright's Windows build: 140 px wide, a 1 px border, 10 px
 * of padding at its start and 36 px at its end, its two triangles 5 px
 * square at 18 px and 13 px from the right. Chromium repeats every list
 * per layer; Firefox and WebKit give the repeat, the origin and WebKit the
 * size once, which CSS repeats for every image. The attachment was not
 * read, and is CSS's initial `scroll`.
 */
const BLUEPRINT = {
  'background-image':
    'linear-gradient(45deg, rgba(0, 0, 0, 0) 50%, rgb(86, 104, 122) 50%), linear-gradient(-45deg, rgba(0, 0, 0, 0) 50%, rgb(86, 104, 122) 50%)',
  'background-repeat': 'no-repeat, no-repeat',
  'background-size': '5px 5px, 5px 5px',
  'background-position-x': 'calc(100% - 18px), calc(100% - 13px)',
  'background-position-y': '52%, 52%',
  'background-origin': 'padding-box, padding-box',
  'background-attachment': 'scroll, scroll',
  'box-sizing': 'border-box',
  width: '140px',
  height: '42px',
  'border-top-width': '1px',
  'border-right-width': '1px',
  'border-bottom-width': '1px',
  'border-left-width': '1px',
  'padding-top': '8px',
  'padding-right': '36px',
  'padding-bottom': '8px',
  'padding-left': '10px',
}

describe('which undecided texts the rule is for', () => {
  test('a text axe gave the gradient alone as its reason, and no other', () => {
    // A rule matched on axe's sentence passes for the wrong reason when the sentence is reworded; and one that took any
    // gradient would decide a text axe also could not place, a pseudo-element over it among them.
    expect(onGradientAlone({ keys: ['bgGradient'] })).toBe(true)
    expect(onGradientAlone({ keys: ['bgImage'] })).toBe(false)
    expect(onGradientAlone({ keys: ['bgGradient', 'pseudoContent'] })).toBe(false)
    expect(onGradientAlone({ keys: [] })).toBe(false)
    expect(onGradientAlone({ reason: "Element's background color could not be determined due to a background gradient" })).toBe(false)
  })
})

describe('reading a computed background', () => {
  test('lists split at their commas, and never inside a gradient or a calc', () => {
    // A split at every comma takes a gradient's colour stops for layers, and finds more images than were drawn.
    expect(splitTop(BLUEPRINT['background-image'], ',')).toHaveLength(2)
    expect(splitTop('calc(100% - 18px) 5px', ' ')).toEqual(['calc(100% - 18px)', '5px'])
  })

  test('lengths, percentages and their sums, as the browsers serialize them, and nothing else', () => {
    // A parser that read `2em` or a product as px would place the gradient where it is not, and decide a text it covers.
    expect(linear('calc(100% - 18px)')).toEqual({ percent: 100, px: -18 })
    expect(linear('calc(-13px + 100%)')).toEqual({ percent: 100, px: -13 })
    expect(linear('52%')).toEqual({ percent: 52, px: 0 })
    expect(linear('0')).toEqual({ percent: 0, px: 0 })
    expect(linear('-2.5px')).toEqual({ percent: 0, px: -2.5 })
    for (const unread of ['2em', 'calc(100% * 0.5)', 'calc(100% -18px)', 'calc(min(10px, 5%))', '', 'auto']) expect(linear(unread)).toBeNull()
  })

  test('a position given from an edge is the same place as its calc', () => {
    // `right 18px` read as 18 px from the left would put the arrow at the text's start, over the text, and call it clear.
    expect(position('right 18px')).toEqual({ percent: 100, px: -18 })
    expect(position('bottom 10%')).toEqual({ percent: 90, px: 0 })
    expect(position('left 4px')).toEqual({ percent: 0, px: 4 })
    expect(position('center')).toEqual({ percent: 50, px: 0 })
    expect(position('center 4px')).toBeNull()
  })

  test("an element's boxes come from its computed size, borders and padding, whichever box its width sizes", () => {
    // A content box taken from a box-sizing it does not have is 2 px or 48 px off, and a gradient that touches the text reads as clear.
    expect(boxesOf(BLUEPRINT)['content-box']).toEqual({ left: 11, top: 9, right: 103, bottom: 33 })
    expect(boxesOf({ ...BLUEPRINT, 'box-sizing': 'content-box', width: '92px', height: '24px' })['content-box']).toEqual({
      left: 11,
      top: 9,
      right: 103,
      bottom: 33,
    })
    expect(boxesOf({ ...BLUEPRINT, width: 'auto' })).toEqual({ why: 'its box is not in px lengths (auto by 42px, border-box)' })
  })

  test("Blueprint's arrow is two squares in the room the select keeps at its end", () => {
    // Where the browsers drew them, read from their pixels on 2026-11-27: within columns 116 to 125 of the 140, in Chromium and Firefox.
    expect(gradientLayers(BLUEPRINT).layers).toEqual([
      { left: 116, top: 1 + 0.52 * 35, right: 121, bottom: 1 + 0.52 * 35 + 5 },
      { left: 121, top: 1 + 0.52 * 35, right: 126, bottom: 1 + 0.52 * 35 + 5 },
    ])
    // Firefox's and WebKit's lists, given once for two images, are each image's.
    const once = {
      ...BLUEPRINT,
      'background-repeat': 'no-repeat',
      'background-size': '5px 5px',
      'background-origin': 'padding-box',
      'background-attachment': 'scroll',
    }
    expect(gradientLayers(once).layers).toEqual(gradientLayers(BLUEPRINT).layers)
    // And the rule's mirror for the other reading order: `left 13px`, `left 18px`.
    const mirrored = gradientLayers({ ...BLUEPRINT, 'padding-right': '10px', 'padding-left': '36px', 'background-position-x': '13px, 18px' }).layers
    expect(mirrored.map((layer) => [layer.left, layer.right])).toEqual([
      [14, 19],
      [19, 24],
    ])
  })
})

describe('when the gradients lie clear of the text', () => {
  test("Blueprint's select, both ways of reading, and at the narrowest width the gates measure", () => {
    // The rule the gates decide 0.14.0's selects by: a problem here leaves every one of them undecided again.
    expect(gradientProblem(BLUEPRINT)).toBeNull()
    expect(gradientProblem({ ...BLUEPRINT, 'padding-right': '10px', 'padding-left': '36px', 'background-position-x': '13px, 18px' })).toBeNull()
    expect(gradientProblem({ ...BLUEPRINT, width: '60px' })).toBeNull()
  })

  test('an arrow in a select that keeps no room for it lies over the text, and is said', () => {
    // 0.13.0's #345: the padding kept for the arrow taken away. Decided as clear, axe would measure the paper beside a muted triangle drawn over the words.
    expect(gradientProblem({ ...BLUEPRINT, 'padding-right': '10px' })).toBe(
      "a gradient over the box its text is drawn in: 116,19 to 121,24 and 121,19 to 126,24, the text's 11,9 to 129,33",
    )
  })

  test('a gradient within a pixel of the content box is over it', () => {
    // A browser snaps an edge to a pixel; a layer that ends where the text's box begins can share that pixel with the text's first column.
    expect(over({ left: 0, top: 0, right: 10, bottom: 10 }, { left: 10 + MARGIN - 0.5, top: 0, right: 50, bottom: 10 })).toBe(true)
    expect(over({ left: 0, top: 0, right: 10, bottom: 10 }, { left: 10 + MARGIN, top: 0, right: 50, bottom: 10 })).toBe(false)
    expect(over({ left: 20, top: 0, right: 20, bottom: 10 }, { left: 10, top: 0, right: 50, bottom: 10 })).toBe(false)
  })

  test('a gradient the rule cannot place is never decided', () => {
    // Each would paint where the rule does not know, under the text among it: fail closed.
    const cases = [
      [{ 'background-image': 'url("arrow.svg")' }, 'a background image that is not a gradient: url("arrow.svg")'],
      [{ 'background-repeat': 'repeat-x, no-repeat' }, 'a gradient drawn more than once (repeat-x)'],
      [{ 'background-attachment': 'fixed' }, 'a gradient whose background-attachment is fixed, not scroll'],
      [{ 'background-origin': 'margin-box' }, 'a gradient placed in a box this gate does not read (margin-box)'],
      [{ 'background-size': '1em 1em' }, 'a gradient of a size this gate does not read (1em 1em)'],
      [{ 'background-position-x': 'calc(100% - 1em)' }, 'a gradient at a position this gate does not read (calc(100% - 1em); 52%)'],
    ]
    for (const [change, why] of cases) expect(gradientProblem({ ...BLUEPRINT, ...change })).toBe(why)
    // A gradient with no size of its own fills its box, the content box within it.
    expect(gradientProblem({ ...BLUEPRINT, 'background-size': 'auto' })).toMatch(/^a gradient over the box its text is drawn in/)
    expect(gradientProblem({ ...BLUEPRINT, 'background-size': 'cover' })).toMatch(/^a gradient over the box its text is drawn in/)
  })

  test('a layer that is none paints nothing, and is not read', () => {
    // `none` beside a gradient is a layer with no image: reading its size or position would refuse a select that is clear.
    expect(gradientProblem({ ...BLUEPRINT, 'background-image': `none, ${splitTop(BLUEPRINT['background-image'], ',')[1]}` })).toBeNull()
  })
})
