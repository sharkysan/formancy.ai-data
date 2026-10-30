import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { computeAccessibleDescription } from 'dom-accessibility-api'
import { createDataClient } from '@formancy/data-client'
import { IDLE_MINUTES, NOT_RUNNING, PERSONAS, PREFIX, START_FAILED } from '@formancy/data-live-demo/worker'
import { demoSession } from './demo.js'
import { PREFERENCES } from './prefs.js'
import { audit, focusedName, paragraphs, unnamed } from './test-accessible.js'
import { demoDoor } from './test-demo.js'
import type { DemoDoor } from './test-demo.js'
import { chooseForm, chooseRenderer, formLink, load, loaded, mount, signInAs } from './test-host.js'
import type { User } from './test-host.js'
import { holdingRequests } from './test-network.js'
import { EDGES, ENGINES, startPlane } from './test-plane.js'
import type { Plane } from './test-plane.js'

/*
 * The host page as the live demo builds it (0070): no token to paste, but
 * the people a visitor may be, each a button that starts the visitor's own
 * server through the demo's Worker and signs them in. The Worker is its own
 * code in front of the real server (test-demo.ts), so every sentence the
 * page shows is one the Worker or the server says, and every person is one
 * the Worker lists.
 *
 * By role and accessible name (formancy.ai 0034). What jsdom cannot see --
 * the keyboard in a real browser, colour, the page under its
 * Content-Security-Policy -- is the browser gate's.
 */

/** The repository, as data-core's manifest names it for npm's provenance: `git+https://….git` read as the page's address. */
const REPOSITORY = (
  JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'data-core', 'package.json'), 'utf8')) as {
    repository: { url: string }
  }
).repository.url
  .replace(/^git\+/, '')
  .replace(/\.git$/, '')

/** How long a sign-in and the menu may take: the server publishes nothing here, but Angular may still be arriving from the last test. */
const ARRIVES_WITHIN = { timeout: 15_000 }

// The demo serves PostgreSQL alone (deploy/demo), and what a sign-in
// decides -- who the server says the visitor is -- is the same on either
// engine.
const POSTGRES = ENGINES[0]

let plane: Plane

beforeAll(async () => {
  plane = await startPlane({ demo: true })
})

afterAll(async () => {
  await plane?.close()
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  window.history.replaceState(null, '', '/')
})

/** The demo's page, mounted as main.tsx mounts its build, in front of a door of its own. */
function demoPage(door: DemoDoor = demoDoor(plane)): { user: User; door: DemoDoor } {
  return { door, user: mount(door.fetch, { base: PREFIX, session: demoSession(door.fetch, PREFIX) }) }
}

/** What each request the page sent was: its method and path. */
const lines = (door: DemoDoor): string[] => door.sent.map((sent) => `${sent.method} ${sent.path}`)

/** The state's name, and what axe and the name check found in it: both empty, or the state says which failed. */
async function floor(state: string): Promise<{ state: string; axe: string[]; unnamed: string[] }> {
  return { state, axe: await audit(), unnamed: unnamed() }
}

const CLEAN = (state: string) => ({ state, axe: [], unnamed: [] })

describe('signed out, the demo', () => {
  // The people are the Worker's: a page that listed its own would offer a
  // sign-in the Worker refuses, and each says what that person may do in
  // the words the policy is derived from, so the page cannot promise a
  // grant the server does not make. A page view starts nothing: the only
  // request is the list, and no token was made.
  test('lists the people the Worker names, each described by what they may do, and starts nothing', async () => {
    const { door } = demoPage()
    for (const persona of PERSONAS) {
      const button = await screen.findByRole('button', { name: `Sign in as ${persona.name}` }, ARRIVES_WITHIN)
      expect({ persona: persona.id, description: computeAccessibleDescription(button) }).toEqual({ persona: persona.id, description: persona.description })
    }
    expect(
      within(screen.getByRole('list', { name: 'People' }))
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(PERSONAS.map((persona) => `Sign in as ${persona.name}`))
    expect(screen.queryByLabelText('Host token')).toBeNull()
    expect(lines(door)).toEqual([`GET ${PREFIX}/session`])
    expect(door.tokens).toEqual([])
  })

  // A visitor arrives without the README: before they start a server the
  // page says what starts, how long it lives -- the Worker's own idle time,
  // not a number typed here -- that one cookie names it, and where the
  // source is, at the address the packages' manifests give.
  test('says what starts, for how long, what the cookie holds, and links the repository; and passes the floor', async () => {
    demoPage()
    await screen.findByRole('list', { name: 'People' }, ARRIVES_WITHIN)
    const card = screen.getByRole('region', { name: 'Sign in' })
    const said = paragraphs(card).join('\n')
    expect(said).toMatch(/your own start on Cloudflare/)
    expect(said).toMatch(/PostgreSQL/)
    expect(said).toContain(`${String(IDLE_MINUTES)} minutes after your last request`)
    expect(said).toMatch(/One cookie holds a random name for your server and nothing else/)
    expect(within(card).getByRole('link', { name: 'sharkysan/formancy.ai-data' }).getAttribute('href')).toBe(REPOSITORY)
    expect(await floor('the people')).toEqual(CLEAN('the people'))
  })

  // A page served without its Worker -- `vite preview`, or a route that
  // lost it -- has nobody to offer. It says so, and offers no button that
  // could only fail.
  test('without the Worker, says the demo did not answer, and offers nobody; and passes the floor', async () => {
    const notTheWorker: typeof globalThis.fetch = async () =>
      new Response('<!doctype html><p>Not found', { status: 404, headers: { 'content-type': 'text/html' } })
    mount(notTheWorker, { base: PREFIX, session: demoSession(notTheWorker, PREFIX) })
    expect((await screen.findByRole('alert', {}, ARRIVES_WITHIN)).textContent).toBe('The demo did not answer in a way this page understands.')
    expect(screen.queryByRole('list', { name: 'People' })).toBeNull()
    expect(await floor('no Worker')).toEqual(CLEAN('no Worker'))
  })
})

describe('signing in as a person', () => {
  // One press is one sign-in, then the menu: the token the Worker answered
  // goes in the Authorization header of the menu's request, and no request
  // carries it in its address or its body, as the token form's never do
  // (0029). Every route is under the demo's path.
  test("sends one POST naming the person, then asks for the menu with the Worker's token, in the header only", async () => {
    const { user, door } = demoPage()
    await signInAs(user, 'Clara')
    await screen.findByRole('navigation', { name: 'Forms' }, ARRIVES_WITHIN)
    expect(lines(door)).toEqual([`GET ${PREFIX}/session`, `POST ${PREFIX}/session`, `GET ${PREFIX}/v1/forms`])
    const [, signIn, menu] = door.sent
    expect({ body: signIn?.body, authorization: signIn?.headers['authorization'] }).toEqual({
      body: JSON.stringify({ persona: 'clara' }),
      authorization: undefined,
    })
    const [token] = door.tokens
    expect(menu?.headers['authorization']).toBe(`Bearer ${String(token)}`)
    for (const sent of door.sent) {
      expect(sent.url).not.toContain(String(token))
      expect(sent.body ?? '').not.toContain(String(token))
    }
    // The menu is the server's for that token: every form it lists to Clara, under Forms.
    const listed = await createDataClient({ token: () => String(token), fetch: plane.fetch }).forms()
    if (!listed.ok) throw new Error(listed.message)
    for (const form of listed.value.forms) await formLink(form.id)
  })

  // The person is who the server says the token names, tenant included: a
  // demo whose clerks shared a tenant would show isolation nowhere. Tenant
  // 1's seeded order opens for Clara and does not exist for Otto.
  test("Clara reads tenant 1's records and Otto does not see them", async () => {
    const clara = demoPage()
    await signInAs(clara.user, 'Clara')
    await chooseForm(clara.user, POSTGRES.formId)
    await chooseRenderer(clara.user)
    await load(clara.user, EDGES.seededOrder)
    await loaded(EDGES.seededOrder)
    cleanup()
    // Clara's place is in the address, which a page arriving there opens.
    window.history.replaceState(null, '', '/')

    const otto = demoPage()
    await signInAs(otto.user, 'Otto')
    await chooseForm(otto.user, POSTGRES.formId)
    await chooseRenderer(otto.user)
    await load(otto.user, EDGES.seededOrder)
    expect((await screen.findByRole('alert', {}, ARRIVES_WITHIN)).textContent).toBe('No such record.')
  })

  // Starting a server takes seconds the first time. The page says so while
  // it waits, keeps the button where the keyboard is -- not disabled, which
  // would drop its focus -- and a second press sends nothing.
  test('says it is starting your server while it waits, and a second press sends nothing; and passes the floor', async () => {
    const door = demoDoor(plane)
    const holding = holdingRequests(door.fetch, ({ method, path }) => method === 'POST' && path === `${PREFIX}/session`)
    const user = mount(holding.fetch, { base: PREFIX, session: demoSession(holding.fetch, PREFIX) })
    await signInAs(user, 'Otto')
    await waitFor(() => expect(holding.held).toEqual([`${PREFIX}/session`]))
    expect(screen.getByRole('status').textContent).toBe('Starting your own server and database: the first start takes a few seconds.')
    // jsdom keeps the focus on an element that is disabled under it, where
    // a browser moves it to the page, so the property is asked as well.
    expect(focusedName()).toBe('Sign in as Otto')
    expect(screen.getByRole('button', { name: 'Sign in as Otto' })).toHaveProperty('disabled', false)
    expect(await floor('starting')).toEqual(CLEAN('starting'))
    await user.click(screen.getByRole('button', { name: 'Sign in as Otto' }))
    expect(holding.held).toEqual([`${PREFIX}/session`])
    await holding.pass()
    await screen.findByRole('navigation', { name: 'Forms' }, ARRIVES_WITHIN)
    expect(lines(door).filter((line) => line === `POST ${PREFIX}/session`)).toHaveLength(1)
  })

  // A start that fails is the Worker's sentence, where the visitor pressed:
  // the place they could not get, and that nothing was started. The button
  // stays, and the next press may start one.
  test("a start that fails is the Worker's sentence, and the next press signs in; and passes the floor", async () => {
    const { user, door } = demoPage()
    door.failNextStart()
    await signInAs(user, 'Otto')
    expect((await screen.findByRole('alert', {}, ARRIVES_WITHIN)).textContent).toBe(START_FAILED)
    expect(screen.queryByRole('navigation', { name: 'Forms' })).toBeNull()
    expect(await floor('a start that failed')).toEqual(CLEAN('a start that failed'))
    await signInAs(user, 'Otto')
    await screen.findByRole('navigation', { name: 'Forms' }, ARRIVES_WITHIN)
  })

  // A token the server does not accept -- signed with another key than the
  // one the visitor's server runs with, as a token from before a restart
  // is -- is the server's sentence where the visitor pressed, and nothing
  // is signed in.
  test("a token the server refuses is the server's sentence, at sign-in", async () => {
    const elsewhere = demoDoor({ fetch: plane.fetch, demoKey: randomBytes(32).toString('base64url') })
    const { user } = demoPage(elsewhere)
    await signInAs(user, 'Clara')
    expect((await screen.findByRole('alert', {}, ARRIVES_WITHIN)).textContent).toBe('A valid host token is required.')
    expect(screen.queryByRole('navigation', { name: 'Forms' })).toBeNull()
  })

  // A visitor's server stops ten minutes after their last request, and
  // takes their changes with it. What they ask next is the Worker's
  // sentence saying so, where the answer would have been.
  test("a server that has stopped is the Worker's sentence, where the answer would have been", async () => {
    const { user, door } = demoPage()
    await signInAs(user, 'Clara')
    await screen.findByRole('navigation', { name: 'Forms' }, ARRIVES_WITHIN)
    door.stop()
    await user.click(await formLink(POSTGRES.formId))
    expect((await screen.findByRole('alert', {}, ARRIVES_WITHIN)).textContent).toBe(NOT_RUNNING)
  })
})

describe('signed in to the demo', () => {
  // Sign out forgets the token, and the people are back with the keyboard
  // on the first of them: the button it was on went with the workspace. The
  // people are the Worker's constants and are not asked for again.
  test('Sign out goes back to the people, the keyboard on the first, with the token forgotten', async () => {
    const { user, door } = demoPage()
    await signInAs(user, 'Vera')
    await user.click(await screen.findByRole('button', { name: 'Sign out' }, ARRIVES_WITHIN))
    await waitFor(() => expect(focusedName()).toBe(`Sign in as ${String(PERSONAS[0]?.name)}`), ARRIVES_WITHIN)
    expect(screen.queryByRole('navigation', { name: 'Forms' })).toBeNull()
    expect(lines(door).filter((line) => line === `GET ${PREFIX}/session`)).toHaveLength(1)
    expect(document.documentElement.outerHTML).not.toContain(String(door.tokens[0]))
  })

  // The token is in the client's closure, as the token form's is, and the
  // page writes no cookie of its own: the demo's is the Worker's, HttpOnly,
  // which a page's script can neither read nor write (here it lives in the
  // door, outside the document). The browser keeps the viewer's two
  // choices and nothing else (0047).
  test('the token is in no storage, no cookie the page wrote, no address and nowhere in the document', async () => {
    const { user, door } = demoPage()
    await signInAs(user, 'Clara')
    await chooseForm(user, POSTGRES.formId)
    const [token] = door.tokens
    const kept = Object.keys(localStorage)
    expect(kept.filter((key) => !(Object.values(PREFERENCES) as string[]).includes(key))).toEqual([])
    expect(kept.map((key) => localStorage.getItem(key) ?? '').filter((value) => value.includes(String(token)))).toEqual([])
    expect(sessionStorage.length).toBe(0)
    expect(document.cookie).toBe('')
    expect(window.location.href).not.toContain(String(token))
    expect(document.documentElement.outerHTML).not.toContain(String(token))
  })
})
