// The contrast axe leaves undecided behind a select's drawn arrow, decided
// (0178), for every browser gate.
//
// axe's colour-contrast gives up on a text whenever an element under it has
// a background image: "Element's background color could not be determined
// due to a background gradient" (its `bgGradient`), wherever the image is
// drawn. Blueprint draws a plain select's arrow as two gradients of the
// muted ink in the room the select keeps at its end (formancy 0.14.0's
// `select:not([multiple])`), so from 0.14.0 every such select on a paper
// was left undecided, and every gate failed it as a contrast nobody
// measured.
//
// The rule is the narrowest that decides it: a select drawn as one box --
// not `multiple`, `size` at most 1 -- of the computed appearance `none`,
// whose undecided contrast axe gives that reason alone for, and whose own
// background images are every one a gradient drawn once, each lying, by
// its computed size, position and origin, at least MARGIN clear of the
// select's content box. A browser draws such a select's chosen text inside
// that box and clips it there, which `selectTextClipped` measures in the
// browser the gate runs, on a page of its own, and each gate checks in
// every browser under one name before its first pass: the rule decides
// nothing in a browser whose probe has not run, or did not hold. So the
// gradients paint nowhere the text is, and the text is asked of axe again
// with the select's background images taken off: axe's own colours, its
// own stack and compositing and its own threshold for the text's size
// decide it, as they decide every other text. Anything else stays
// undecided, and the gate fails it: an image that is not a gradient, one
// that repeats, one whose size or position this file cannot read, one over
// the content box, an element that is not such a select, and whatever axe
// still cannot decide with the images off. What axe then measures below
// the ratio it asks is kept apart, for each gate's check of it.
//
// Each gate's audit keeps the elements axe left undecided, as axe answered,
// in `window.formancyGateUndecided`, and gives each node its index there
// (`at`), its markup (`html`), axe's reason and axe's message keys
// (`keys`); `decideGradients` reads them before the next audit replaces
// them. What is run in the page only reads and asks axe; every decision is
// a pure function here, and gradient-contrast.test.mjs holds each.

/** How far clear of the content box a gradient lies, and how far past it the probe lets a text's ink go: a pixel either way for how a browser snaps an edge. */
export const MARGIN = 1

/** axe's message key for a text it could not decide because of a background gradient. */
const GRADIENT = 'bgGradient'

/** Whether axe left `node` undecided for a background gradient and for nothing else. */
export const onGradientAlone = (node) => Array.isArray(node.keys) && node.keys.length === 1 && node.keys[0] === GRADIENT

/** `value` split at every `separator` outside parentheses, each part trimmed. */
export function splitTop(value, separator) {
  const parts = []
  let depth = 0
  let part = ''
  for (const character of value) {
    if (character === '(') depth += 1
    if (character === ')') depth -= 1
    if (depth === 0 && (separator === ' ' ? /\s/.test(character) : character === separator)) {
      if (part.trim() !== '') parts.push(part.trim())
      part = ''
    } else part += character
  }
  if (part.trim() !== '') parts.push(part.trim())
  return parts
}

/**
 * A computed length-percentage as `{ percent, px }`: `12px`, `52%`, `0`, or
 * a `calc()` of such terms added and subtracted, as the browsers serialize
 * them; null for anything else -- a product, a nested function, an em.
 */
export function linear(text) {
  const value = text.trim()
  if (value === '0') return { percent: 0, px: 0 }
  const inner = /^calc\((.*)\)$/s.exec(value)?.[1] ?? value
  const term = /\s*(?:([+-])\s+)?(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(px|%)\s*/iy
  const sum = { percent: 0, px: 0 }
  let first = true
  while (term.lastIndex < inner.length) {
    const match = term.exec(inner)
    if (match === null) return null
    const [, operator, number, unit] = match
    if (first === (operator !== undefined)) return null
    const signed = (operator === '-' ? -1 : 1) * Number(number)
    if (unit === '%') sum.percent += signed
    else sum.px += signed
    first = false
  }
  return first ? null : sum
}

/** Where each keyword puts an image, as a share of the room it has; `center` takes no offset. */
const EDGES = Object.freeze({ left: 0, top: 0, center: 50, right: 100, bottom: 100 })

/** One axis of a computed `background-position`: a length-percentage, a keyword, or a keyword and the offset from its edge; null for anything else. */
export function position(text) {
  const keyed = /^(left|right|top|bottom|center)(?:\s+(.+))?$/.exec(text.trim())
  if (keyed === null) return linear(text)
  const [, keyword, rest] = keyed
  if (rest === undefined) return { percent: EDGES[keyword], px: 0 }
  if (keyword === 'center') return null
  const offset = linear(rest)
  if (offset === null) return null
  return keyword === 'right' || keyword === 'bottom' ? { percent: 100 - offset.percent, px: 0 - offset.px } : { percent: offset.percent, px: offset.px }
}

/** A computed px length as a number; NaN for anything else. */
const px = (text) => (/^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?px$/.test(text.trim()) ? Number.parseFloat(text) : Number.NaN)

/** The `at`th value of a computed list, repeated as CSS repeats a background's lists to the number of its images. */
const layerOf = (list, at) => list[at % list.length]

/** A gradient's size on one axis: a length-percentage of `room`, or, for `auto` -- a gradient has no size of its own -- the whole of it. */
function sizeOn(text, room) {
  if (text === 'auto') return room
  const value = linear(text)
  return value === null ? Number.NaN : (value.percent / 100) * room + value.px
}

/**
 * The boxes of an element, in px from its border box's top left, untouched
 * by any transform: the border, padding and content boxes, read from its
 * computed `width`, `height`, `box-sizing`, borders and padding. A
 * `{ why }` when one of them is not a px length.
 */
export function boxesOf(style) {
  const side = (property) => ['top', 'right', 'bottom', 'left'].map((edge) => px(style[property.replace('*', edge)]))
  const border = side('border-*-width')
  const padding = side('padding-*')
  const [width, height] = [px(style.width), px(style.height)]
  if ([...border, ...padding, width, height].some(Number.isNaN))
    return { why: `its box is not in px lengths (${style.width} by ${style.height}, ${style['box-sizing']})` }
  const [bt, br, bb, bl] = border
  const [pt, pr, pb, pl] = padding
  const outer = style['box-sizing'] === 'border-box' ? { width, height } : { width: width + pl + pr + bl + br, height: height + pt + pb + bt + bb }
  const box = (left, top, right, bottom) => ({ left, top, right: outer.width - right, bottom: outer.height - bottom })
  return {
    'border-box': box(0, 0, 0, 0),
    'padding-box': box(bl, bt, br, bb),
    'content-box': box(bl + pl, bt + pt, br + pr, bb + pb),
  }
}

/**
 * Where each layer of an element's background image is painted, from its
 * computed style -- `background-image`, `-repeat`, `-size`, `-position-x`,
 * `-position-y`, `-origin` and `-attachment` -- as `{ layers, boxes }`, each
 * layer a box in the coordinates of `boxesOf`; or `{ why }` for an image
 * this rule does not read: one that is not a gradient, one drawn more than
 * once, one fixed to the window, a size or a position in a form it does not
 * parse. A layer that is `none` paints nothing and is left out.
 */
export function gradientLayers(style) {
  const boxes = boxesOf(style)
  if ('why' in boxes) return boxes
  const images = splitTop(style['background-image'], ',')
  const lists = Object.fromEntries(
    ['background-repeat', 'background-size', 'background-position-x', 'background-position-y', 'background-origin', 'background-attachment'].map((property) => [
      property,
      splitTop(style[property], ','),
    ]),
  )
  const layers = []
  for (const [at, image] of images.entries()) {
    if (image === 'none') continue
    if (!/^(?:repeating-)?(?:linear|radial|conic)-gradient\(/.test(image)) return { why: `a background image that is not a gradient: ${image.slice(0, 40)}` }
    const of = (property) => layerOf(lists[property], at) ?? ''
    if (!/^no-repeat(?: no-repeat)?$/.test(of('background-repeat'))) return { why: `a gradient drawn more than once (${of('background-repeat')})` }
    if (of('background-attachment') !== 'scroll') return { why: `a gradient whose background-attachment is ${of('background-attachment')}, not scroll` }
    const area = boxes[of('background-origin')]
    if (area === undefined) return { why: `a gradient placed in a box this gate does not read (${of('background-origin')})` }
    const room = { width: area.right - area.left, height: area.bottom - area.top }
    const [sizeX, sizeY = 'auto'] = splitTop(of('background-size'), ' ')
    const [width, height] = ['cover', 'contain'].includes(sizeX) ? [room.width, room.height] : [sizeOn(sizeX, room.width), sizeOn(sizeY, room.height)]
    if (Number.isNaN(width) || Number.isNaN(height)) return { why: `a gradient of a size this gate does not read (${of('background-size')})` }
    const [x, y] = [position(of('background-position-x')), position(of('background-position-y'))]
    if (x === null || y === null)
      return { why: `a gradient at a position this gate does not read (${of('background-position-x')}; ${of('background-position-y')})` }
    const left = area.left + (x.percent / 100) * (room.width - width) + x.px
    const top = area.top + (y.percent / 100) * (room.height - height) + y.px
    layers.push({ left, top, right: left + width, bottom: top + height })
  }
  return { layers, boxes }
}

/** Whether `layer` paints anything within MARGIN of `box`: a layer with no area paints nothing. */
export function over(layer, box) {
  if (layer.right <= layer.left || layer.bottom <= layer.top) return false
  return layer.left < box.right + MARGIN && layer.right > box.left - MARGIN && layer.top < box.bottom + MARGIN && layer.bottom > box.top - MARGIN
}

/** Why the gradients of an element of computed `style` cannot be set aside for its text, or null when every one lies clear of its content box. */
export function gradientProblem(style) {
  const read = gradientLayers(style)
  if ('why' in read) return read.why
  const content = read.boxes['content-box']
  const lying = read.layers.filter((layer) => over(layer, content))
  if (lying.length === 0) return null
  const say = ({ left, top, right, bottom }) =>
    `${String(Math.round(left))},${String(Math.round(top))} to ${String(Math.round(right))},${String(Math.round(bottom))}`
  return `a gradient over the box its text is drawn in: ${lying.map(say).join(' and ')}, the text's ${say(content)}`
}

/**
 * Whether an element, as `decideOne` reads it in the page -- its
 * `localName`, `multiple` and `size` -- is a select drawn as one box:
 * neither `multiple` nor of a `size` past 1. An element that is not a
 * select has neither property, and is not one.
 */
export const oneBox = ({ tag, multiple, size }) => tag === 'select' && multiple === false && Number.isInteger(size) && size <= 1

/**
 * Why the rule leaves a node undecided without asking axe again, or null to
 * ask it: `probed`, this browser's probe -- undefined before one has run,
 * null when it held, else what it saw -- and `read`, what `decideOne` read
 * of the node in the page, null for a node gone from it.
 */
export function whyLeft(probed, read) {
  if (probed === undefined) return 'no probe has yet shown that this browser clips a select’s text to its content box'
  if (probed !== null) return `this browser’s probe did not hold: ${probed}`
  if (read === null) return 'gone from the page'
  if (!oneBox(read)) return 'a gradient behind a text that is not a select drawn as one box'
  const appearance = read.style.appearance ?? ''
  if (appearance !== 'none') return `a select of the appearance ${appearance || 'nobody read'}, where the probe measured none`
  return gradientProblem(read.style)
}

/**
 * What axe's colour-contrast answered of the select alone, its gradients
 * set aside -- `violations`, the data of each node it failed; `incomplete`,
 * the message of each it could not decide; `passes`, how many it passed --
 * as the rule's verdict: `passes`, a `violation` with axe's ratio and the
 * ratio it asks, or `left` with why.
 */
export function verdictOf({ violations, incomplete, passes }) {
  if (violations.length > 0) return { verdict: 'violation', ratio: violations[0].contrastRatio, expected: violations[0].expectedContrastRatio }
  if (incomplete.length > 0) return { verdict: 'left', why: `its gradients set aside, still undecided: ${incomplete[0]}` }
  return passes > 0 ? { verdict: 'passes' } : { verdict: 'left', why: 'its gradients set aside, axe measured nothing' }
}

/** What each browser's probe found, by the Browser it ran in: null when it held, else the sentence `selectTextClipped` returned. */
const probes = new WeakMap()

/** The computed properties the rule reads: `gradientProblem`'s, and the appearance the probe measured. */
const READ = [
  'appearance',
  'background-image',
  'background-repeat',
  'background-size',
  'background-position-x',
  'background-position-y',
  'background-origin',
  'background-attachment',
  'box-sizing',
  'width',
  'height',
  ...['top', 'right', 'bottom', 'left'].flatMap((edge) => [`border-${edge}-width`, `padding-${edge}`]),
]

/**
 * One node the rule is for, in `page`: read in the page, decided by
 * `whyLeft`, and only then asked of axe again, its verdict `verdictOf`'s.
 * The select's own inline `background-image` is put back through the CSSOM
 * as it was, or its `style` attribute removed when it had none, whatever
 * axe does: a page's `style-src` without 'unsafe-inline' refuses a style
 * attribute a script sets, and Firefox then empties the element's inline
 * style, while it refuses nothing set through the CSSOM -- measured under
 * `style-src 'self'` on 2026-11-27 in Chromium 153 and Firefox 155.
 */
async function decideOne(page, at) {
  const read = await page.evaluate(
    ({ index, properties }) => {
      const element = window.formancyGateUndecided?.[index]
      if (element === undefined || !element.isConnected) return null
      const style = getComputedStyle(element)
      return {
        tag: element.localName,
        multiple: element.multiple,
        size: element.size,
        style: Object.fromEntries(properties.map((property) => [property, style.getPropertyValue(property)])),
      }
    },
    { index: at, properties: READ },
  )
  const why = whyLeft(probes.get(page.context().browser()), read)
  if (why !== null) return { verdict: 'left', why }
  const answer = await page.evaluate(async (index) => {
    const element = window.formancyGateUndecided[index]
    const attribute = element.getAttribute('style')
    const inline = { value: element.style.getPropertyValue('background-image'), priority: element.style.getPropertyPriority('background-image') }
    element.style.setProperty('background-image', 'none', 'important')
    try {
      // No preload, as the examples page's audit says: the rule reads no stylesheet, and a fetch from elsewhere is the page's to fail.
      const results = await window.axe.run(element, { runOnly: { type: 'rule', values: ['color-contrast'] }, preload: false })
      const first = (outcome) => outcome.flatMap((rule) => rule.nodes).map((node) => node.any[0] ?? {})
      return {
        violations: first(results.violations).map((check) => check.data ?? {}),
        incomplete: first(results.incomplete).map((check) => check.message ?? ''),
        passes: first(results.passes).length,
      }
    } finally {
      if (attribute === null) element.removeAttribute('style')
      else if (inline.value === '') element.style.removeProperty('background-image')
      else element.style.setProperty('background-image', inline.value, inline.priority)
    }
  }, at)
  return verdictOf(answer)
}

/**
 * The undecided nodes of the audit just run that the rule is for, decided:
 * `rest`, the nodes it is not for, for the gate's own deciders; `left`, one
 * sentence each for a node it left undecided; and `failing`, one each for a
 * node axe measured, its gradients set aside, below the ratio it asks.
 */
export async function decideGradients(page, undecided) {
  const rest = []
  const left = []
  const failing = []
  for (const node of undecided) {
    if (!onGradientAlone(node)) {
      rest.push(node)
      continue
    }
    const decided = await decideOne(page, node.at)
    if (decided.verdict === 'violation')
      failing.push(`${node.html} (its gradients clear of its text, at ${String(decided.ratio)}:1, below the ${String(decided.expected)} axe asks)`)
    else if (decided.verdict === 'left') left.push(`${node.html} (axe: ${String(node.reason)} -- ${decided.why})`)
  }
  return { rest, left, failing }
}

/** The probe's selects: black on white, a label far longer than the box, one each way of reading, padded at their end as Blueprint pads a select for its arrow. */
const PROBE_PAGE = `<!doctype html><style>body{margin:0;background:#fff}select{appearance:none;-webkit-appearance:none;box-sizing:border-box;display:block;width:160px;height:40px;margin:0 0 8px;padding-block:8px;padding-inline:10px 40px;border:0;border-radius:0;outline:none;background:#fff;color:#000;font:16px/24px sans-serif}</style><select dir="ltr"><option>${'W'.repeat(40)}</option></select><select dir="rtl"><option>${'W'.repeat(40)}</option></select>`

/**
 * What the rule rests on, measured in `browser` on a page of its own: a
 * select drawn as one box, of the appearance `none`, draws its chosen text
 * inside its content box, reading either way, and clips it there. Each probe select's label runs
 * far past its box; its pixels are read from a screenshot decoded by the
 * page, and ink -- a pixel whose darkest channel is below half -- must lie
 * inside the content box, reach within 12 px of its end, and nowhere be
 * more than MARGIN past it. Null when it holds, or a sentence saying what
 * the browser drew; kept for `browser`, so that `decideGradients` decides a
 * select in it only once the probe has held there.
 */
export async function selectTextClipped(browser) {
  const verdict = await probeSelects(browser)
  probes.set(browser, verdict)
  return verdict
}

/** `selectTextClipped`'s measurement, in a page of its own in `browser`. */
async function probeSelects(browser) {
  const page = await browser.newPage({ viewport: { width: 320, height: 200 } })
  try {
    await page.setContent(PROBE_PAGE)
    const problems = []
    for (const direction of ['ltr', 'rtl']) {
      const select = page.locator(`select[dir="${direction}"]`)
      const box = await select.evaluate((element) => {
        const { left, top, width, height } = element.getBoundingClientRect()
        const style = getComputedStyle(element)
        const edge = (side) => Number.parseFloat(style.getPropertyValue(`padding-${side}`)) + Number.parseFloat(style.getPropertyValue(`border-${side}-width`))
        return { left, top, width, height, content: { left: edge('left'), top: edge('top'), right: width - edge('right'), bottom: height - edge('bottom') } }
      })
      const picture = await page.screenshot({
        clip: { x: box.left, y: box.top, width: box.width, height: box.height },
        scale: 'css',
        animations: 'disabled',
        caret: 'hide',
      })
      const ink = await page.evaluate(
        async ({ data, content, margin, end }) => {
          const image = new Image()
          image.src = `data:image/png;base64,${data}`
          await image.decode()
          const canvas = document.createElement('canvas')
          canvas.width = image.width
          canvas.height = image.height
          const context = canvas.getContext('2d', { willReadFrequently: true })
          context.drawImage(image, 0, 0)
          const pixels = context.getImageData(0, 0, image.width, image.height).data
          const counts = { inside: 0, atEnd: 0, past: 0 }
          for (let y = 0; y < image.height; y += 1) {
            for (let x = 0; x < image.width; x += 1) {
              const at = (y * image.width + x) * 4
              if (Math.min(pixels[at], pixels[at + 1], pixels[at + 2]) >= 128) continue
              // The pixel's square, from x to x + 1, against the box.
              const inside = x >= content.left && x + 1 <= content.right && y >= content.top && y + 1 <= content.bottom
              const near = x >= content.left - margin && x + 1 <= content.right + margin && y >= content.top - margin && y + 1 <= content.bottom + margin
              if (!near) counts.past += 1
              if (inside) counts.inside += 1
              if (inside && (end === 'right' ? x + 1 > content.right - 12 : x < content.left + 12)) counts.atEnd += 1
            }
          }
          return counts
        },
        { data: picture.toString('base64'), content: box.content, margin: MARGIN, end: direction === 'ltr' ? 'right' : 'left' },
      )
      if (ink.past > 0) problems.push(`read ${direction}, it drew ${String(ink.past)} pixels of its text past its content box`)
      else if (ink.inside === 0 || ink.atEnd === 0)
        problems.push(`read ${direction}, its text never reached its content box's end, so the probe showed nothing`)
    }
    return problems.length === 0 ? null : problems.join('; ')
  } finally {
    await page.close()
  }
}
