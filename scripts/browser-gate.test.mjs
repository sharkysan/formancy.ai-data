import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { agGridRowProblem, declaredFamilies, focusScrollProblem, fontProblem, lostCreate, rowUnmeasured, systemOf, unlikeTheTable } from './browser-gate.mjs'

/**
 * What every browser gate does to a page in every browser (0058), in the
 * parts that need no browser: the web fonts a built page asks for, what a
 * pass that loaded them or refused them is failed with, the system a run
 * records, the sentence a fact's check fails with, and what 0058's rows say
 * of what a browser did or said. What the page does with them is the
 * gates' own, in each browser.
 */
let dirs = []
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
})
const built = (html) => {
  const dir = mkdtempSync(join(tmpdir(), 'formancy-data-browser-gate-'))
  dirs.push(dir)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'index.html'), html, 'utf8')
  return dir
}

const LINK = 'https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@75..125,500..800&amp;family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap'

describe('declaredFamilies', () => {
  // The families are what the built page asks Google Fonts for, read from
  // the page itself: typed here, a family added to index.html would be
  // checked by nobody, and one removed would fail every pass for a font the
  // page no longer wants.
  test('reads every family of the built page’s Google Fonts stylesheet, its axes left off and `+` read as a space', () => {
    const dir = built(`<!doctype html><link rel="preconnect" href="https://fonts.googleapis.com" /><link href="${LINK}" rel="stylesheet" />`)
    expect(declaredFamilies(dir)).toEqual(['Archivo', 'IBM Plex Mono', 'IBM Plex Sans'])
  })

  test('is empty for a page that asks Google Fonts for nothing', () => {
    expect(declaredFamilies(built('<!doctype html><link rel="preconnect" href="https://fonts.googleapis.com" />'))).toEqual([])
  })
})

describe('fontProblem', () => {
  const families = ['Archivo', 'IBM Plex Mono', 'IBM Plex Sans']

  // 0021 chose to measure whichever fonts arrive and print which. A browser
  // with no TLS, or a network that refuses Google Fonts, then reports a
  // web-font pass that measured the fallback stack, and nothing fails:
  // in the probe of 2026-10-12, WebKit loaded none in every pass and all
  // 119 checks passed.
  test('fails a pass that does not refuse the web fonts unless every family the page asks for loaded', () => {
    expect(fontProblem({ families, loaded: [...families], refused: false })).toBeNull()
    expect(fontProblem({ families, loaded: ['Archivo'], refused: false })).toBe('IBM Plex Mono and IBM Plex Sans did not load, so this pass measured the fallback stack in their place')
  })

  // A pass whose Google Fonts stylesheet never arrived -- seen once on
  // 2026-10-13, the first Chromium pass of a run through a proxy, and not
  // again in two runs after -- is the network's, not the page's: the
  // failure says how many files the page fetched from Google Fonts, so a
  // red leg can be told from a page that stopped asking.
  test('says how many files the page fetched from Google Fonts when it fails', () => {
    expect(fontProblem({ families, loaded: [], fetched: 0, refused: false })).toBe('Archivo, IBM Plex Mono and IBM Plex Sans did not load, so this pass measured the fallback stack in their place (the page fetched 0 files from Google Fonts)')
    expect(fontProblem({ families, loaded: ['Archivo'], fetched: 1, refused: true })).toBe('Archivo loaded anyway, so this pass measured the web fonts, not the fallback stack (the page fetched 1 file from Google Fonts)')
  })

  // Nothing checked that the refusing pass refused: a route that stopped
  // matching Google's hosts would measure the web fonts twice, and the
  // fallback stack never.
  test('fails the refusing pass unless none loaded', () => {
    expect(fontProblem({ families, loaded: [], refused: true })).toBeNull()
    expect(fontProblem({ families, loaded: ['IBM Plex Sans'], refused: true })).toBe('IBM Plex Sans loaded anyway, so this pass measured the web fonts, not the fallback stack')
  })

  // A page whose link the gate cannot read would pass both checks with
  // nothing to compare: neither "all of none loaded" nor "none loaded" says
  // anything about the page.
  test('fails both kinds of pass for a page that asks for no family', () => {
    for (const refused of [false, true]) expect(fontProblem({ families: [], loaded: [], refused })).toBe('the built page asks Google Fonts for nothing; the gate reads its families from dist/index.html')
  })
})

describe('systemOf', () => {
  const answers = (table) => (command, args) => {
    const key = `${command} ${args.at(-1)}`
    if (!(key in table)) throw new Error(`${command}: not found`)
    return table[key]
  }

  // WebKit's networking, TLS and EGL are the runner's packages, not
  // Playwright's, so the report says which versions each run had: an image
  // update that moved libsoup moves 0058's WebKit facts with no change here.
  test('records the fallback family and the version of every package the browser takes from the system', () => {
    const run = answers({ 'fc-match sans-serif': 'DejaVu Sans,DejaVu Sans Condensed', 'dpkg-query libsoup-3.0-0': '3.4.4-5ubuntu0.5', 'dpkg-query glib-networking': '2.80.0-1build1', 'dpkg-query libegl-mesa0': '25.0.7-0ubuntu0.24.04.2' })
    expect(systemOf('webkit', { run })).toEqual({
      fallback: { family: 'DejaVu Sans' },
      packages: [
        { name: 'libsoup-3.0-0', gives: 'networking', version: '3.4.4-5ubuntu0.5' },
        { name: 'glib-networking', gives: 'TLS', version: '2.80.0-1build1' },
        { name: 'libegl-mesa0', gives: 'EGL', version: '25.0.7-0ubuntu0.24.04.2' },
      ],
    })
    expect(systemOf('chromium', { run })).toEqual({ fallback: { family: 'DejaVu Sans' }, packages: [] })
  })

  // A machine without fontconfig's tools or dpkg -- macOS, Windows, another
  // distribution -- still runs the gate; what it could not ask is null, with
  // why, never a guess.
  test('records null, with the reason, for what the machine could not answer', () => {
    expect(systemOf('webkit', { run: answers({}) })).toEqual({
      fallback: { family: null, why: 'fc-match gave no answer: fc-match: not found' },
      packages: [
        { name: 'libsoup-3.0-0', gives: 'networking', version: null, why: 'dpkg-query gave no version: dpkg-query: not found' },
        { name: 'glib-networking', gives: 'TLS', version: null, why: 'dpkg-query gave no version: dpkg-query: not found' },
        { name: 'libegl-mesa0', gives: 'EGL', version: null, why: 'dpkg-query gave no version: dpkg-query: not found' },
      ],
    })
  })
})

describe('unlikeTheTable', () => {
  // A fact's check has one name in every browser, so its failure must say
  // which browser did what, what 0058's table says, and what to do: a
  // browser release changed it, and the table is measured again.
  test('names the browser, what it did, what the table says and what changed it', () => {
    expect(unlikeTheTable('firefox', { did: 'reached the skip link', says: 'it does not' })).toBe('Firefox reached the skip link; 0058’s table says it does not: a Firefox release changed this, measure it again')
    expect(unlikeTheTable('webkit', { did: 'sent the lost create twice on a fresh connection', says: 'once', changedBy: 'WebKit or libsoup' })).toBe(
      'WebKit sent the lost create twice on a fresh connection; 0058’s table says once: a WebKit or libsoup release changed this, measure it again',
    )
  })
})

describe('lostCreate', () => {
  const sent = (...sendings) => sendings.map(([connection, earlier, passedOver = 0]) => ({ connection, earlier, passedOver }))

  // Chromium and Firefox take an idle kept-alive connection for a POST where
  // there is one (0058's postConnection), and only on such a connection
  // send a lost one again, which is the case 0031 exists for. A row that
  // accepted any connection let a create on a new one pass, sent once, with
  // the resend measured by nothing; a new connection taken while an idle
  // one stood ready is a browser that changed, and one taken with none idle
  // is the other row, held as it says.
  test('fails a browser that takes an idle connection when it opened a new one while one stood idle, and holds the other row when none did', () => {
    expect(lostCreate('chromium', sent([7, 0, 2]))).toEqual({
      connection: 'fresh',
      took: 'Chromium sent it on a new connection while 2 kept-alive connection(s) stood idle; 0058’s table says it takes an idle one where there is one: a Chromium release changed this, measure it again',
      often: null,
    })
    expect(lostCreate('firefox', sent([7, 0, 0]))).toEqual({ connection: 'fresh', took: null, often: null })
    expect(lostCreate('chromium', sent([2, 20, 1], [8, 0, 3]))).toEqual({ connection: 'reused', took: null, often: null })
  })

  // WebKit opens a new connection for every POST (libsoup's
  // connection manager): one that had carried a request is a WebKit or
  // libsoup that changed, and so is a second sending on either.
  test('fails WebKit on a connection that carried a request, and a second sending', () => {
    expect(lostCreate('webkit', sent([3, 0, 4]))).toEqual({ connection: 'fresh', took: null, often: null })
    expect(lostCreate('webkit', sent([3, 2]))).toEqual({
      connection: 'reused',
      took: 'WebKit sent it on a connection that had carried 2 request(s); 0058’s table says it takes a new one for every POST: a WebKit or libsoup release changed this, measure it again',
      often: null,
    })
    expect(lostCreate('webkit', sent([3, 0], [9, 0])).often).toBe('WebKit sent the lost create 2 times on a fresh connection; 0058’s table says once: a WebKit or libsoup release changed this, measure it again')
  })

  test('fails a browser that sent the lost create once where the table says twice, and a marker that never crossed', () => {
    expect(lostCreate('firefox', sent([4, 25])).often).toBe('Firefox sent the lost create once on a reused connection; 0058’s table says twice: a Firefox release changed this, measure it again')
    expect(lostCreate('chromium', [])).toEqual({ connection: null, took: 'the marker never crossed the hop', often: 'the marker never crossed the hop' })
  })
})

describe('rowUnmeasured', () => {
  // Each pass holds the row of the connection its create took. A run whose
  // creates all took the other connection -- the server's keep-alive
  // timeout, a pool that changed, a page that left none idle at Save --
  // passed every pass and measured nothing of the row the browser takes
  // when it can choose: for Chromium and Firefox, the resend 0031 rests on.
  test('fails a run in which no lost create took the connection the browser takes when it can choose', () => {
    expect(rowUnmeasured('chromium', new Set(['fresh']))).toBe(
      'Chromium sent every lost create of this run on a new connection, so 0058’s row for a reused one -- sent again, which 0031 rests on -- was measured by nothing',
    )
    expect(rowUnmeasured('firefox', new Set())).toBe('no lost create of this run crossed the hop, so 0058’s row for Firefox on a reused connection -- sent again, which 0031 rests on -- was measured by nothing')
    expect(rowUnmeasured('chromium', new Set(['fresh', 'reused']))).toBeNull()
    expect(rowUnmeasured('webkit', new Set(['fresh']))).toBeNull()
    expect(rowUnmeasured('webkit', new Set(['reused']))).toBe('WebKit sent every lost create of this run on a reused connection, so 0058’s row for a fresh one -- sent once -- was measured by nothing')
  })
})

describe('agGridRowProblem', () => {
  // What each browser said it was, as the gates recorded it on 2026-10-13.
  const SAID = {
    chromium: { userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/153.0.8010.12 Safari/537.36', platform: 'Linux x86_64', maxTouchPoints: 0 },
    firefox: { userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:155.0) Gecko/20100101 Firefox/155.0', platform: 'Linux x86_64', maxTouchPoints: 0 },
    webkit: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Safari/605.1.15', platform: 'Linux x86_64', maxTouchPoints: 0 },
  }

  test('passes each browser as it said it was', () => {
    for (const [browser, said] of Object.entries(SAID)) {
      for (const id of ['claimsSafari', 'claimsMacOs']) expect(agGridRowProblem(browser, id, said), `${id} in ${browser}`).toBeNull()
    }
  })

  // AG Grid decides Safari by the user agent and macOS and iOS by the
  // platform and the touch points. Playwright's Linux WebKit names a Mac in
  // its user agent and Linux in its platform; a release that said MacIntel
  // would put the grids on their macOS paths -- ag-apple-scrollbar among
  // them -- with a user-agent check alone still green.
  test('fails a browser whose platform AG Grid would take for a Mac or an iOS device', () => {
    expect(agGridRowProblem('webkit', 'claimsMacOs', { ...SAID.webkit, platform: 'MacIntel' })).toBe(
      'WebKit names its platform as a Mac or an iOS device to AG Grid 36.2.0 (MacIntel, 0 touch points); 0058’s table says it does not: a Playwright release changed this, measure it again',
    )
    expect(agGridRowProblem('webkit', 'claimsMacOs', { ...SAID.webkit, platform: 'iPhone' })).not.toBeNull()
    // An iPad asking for the desktop site says MacIntel and has touch points.
    expect(agGridRowProblem('chromium', 'claimsMacOs', { ...SAID.chromium, platform: 'MacIntel', maxTouchPoints: 5 })).not.toBeNull()
    expect(agGridRowProblem('chromium', 'claimsMacOs', { ...SAID.chromium, platform: 'Linux armv81', maxTouchPoints: 5 })).toBeNull()
  })

  test('fails a browser that names itself Safari where the table says it does not, and the other way', () => {
    expect(agGridRowProblem('chromium', 'claimsSafari', SAID.webkit)).toBe(
      `Chromium names itself Safari to AG Grid 36.2.0 (${SAID.webkit.userAgent}); 0058’s table says it does not: a Playwright release changed this, measure it again`,
    )
    expect(agGridRowProblem('webkit', 'claimsSafari', SAID.chromium)).toMatch(/^WebKit does not name itself Safari to AG Grid 36\.2\.0/)
  })
})

describe('focusScrollProblem', () => {
  // The host gate's probe (focusScroll in apps/host/scripts/browser/
  // measure.mjs), as each browser answered it on 2026-10-16: after every
  // focus that scrolled the window or a scroller, WebKit still said the
  // scroll from before it in the focusing task; Chromium and Firefox said
  // the new one.
  const answered = (window, scroller) => ({ window: { trials: 4, late: window }, scroller: { trials: 4, late: scroller } })
  const MEASURED = { chromium: answered(0, 0), firefox: answered(0, 0), webkit: answered(4, 4) }

  test('passes each browser as it answered', () => {
    for (const [browser, counts] of Object.entries(MEASURED)) expect(focusScrollProblem(browser, counts), browser).toBeNull()
  })

  // One late answer of each kind is enough to say a browser does not say
  // at once: the gate waits for a rendering update in it either way.
  test('passes WebKit late in some trials of each kind and not in all', () => {
    expect(focusScrollProblem('webkit', answered(1, 2))).toBeNull()
  })

  // A WebKit release that said a scroller's scroll at once, or a Chromium
  // that stopped saying the window's, is a row that no longer holds: the
  // host gate waits for a rendering update between the keys that scroll its
  // grid because of it, and the table must say why.
  test('fails a browser that answered other than the table says, for either kind of scroll', () => {
    expect(focusScrollProblem('webkit', answered(4, 0))).toBe(
      'WebKit said where every one of 4 focuses scrolled a scroller, in the task that focused; 0058’s table says it says so only after a rendering update: a WebKit release changed this, measure it again',
    )
    expect(focusScrollProblem('chromium', answered(2, 0))).toBe(
      'Chromium went on saying where the window was before 2 of 4 focuses scrolled it, in the task that focused; 0058’s table says it says so at once: a Chromium release changed this, measure it again',
    )
  })

  // A probe whose focuses scrolled nothing of one kind measured nothing of
  // it, and would pass Chromium and Firefox while saying nothing of them.
  test('fails a probe whose focuses scrolled nothing of one kind', () => {
    expect(focusScrollProblem('firefox', { window: { trials: 4, late: 0 }, scroller: { trials: 0, late: 0 } })).toBe(
      'no focus of the probe scrolled a scroller, so 0058’s reportsFocusScroll was measured by nothing there',
    )
  })
})
