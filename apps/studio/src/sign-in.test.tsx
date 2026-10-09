import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { cleanup, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { audit, mount, paragraphs, servedDocument, signIn, unnamed } from './test-studio.js'
import { startPlane, TOKENS } from './test-server.js'
import type { TestPlane } from './test-server.js'

/**
 * Step 1, signing in: a host token, checked by the server, and the server's
 * answer shown -- so a token for the wrong person, issuer or role is visible
 * before anything is built with it.
 */
let plane: TestPlane

beforeEach(async () => {
  plane = await startPlane()
  servedDocument()
})

afterEach(async () => {
  cleanup()
  await plane.close()
})

async function tryToken(token: string) {
  const user = userEvent.setup()
  mount(plane.fetch)
  await user.type(screen.getByLabelText('Host token'), token)
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
  return user
}

/** The definition list of who a token names, as term and description pairs. */
function identity(region: HTMLElement): Record<string, string> {
  const terms = within(region).getAllByRole('term').map((term) => term.textContent ?? '')
  const details = within(region).getAllByRole('definition').map((detail) => detail.textContent ?? '')
  return Object.fromEntries(terms.map((term, index) => [term, details[index] ?? '']))
}

describe('signing in', () => {
  // A token the server does not accept must say so in the server's words, and
  // go no further: a studio that let somebody "in" on an unchecked token
  // would show steps that all fail.
  test('refuses a token the server does not accept, in its words', async () => {
    await tryToken('not-a-token')
    expect((await screen.findByRole('alert')).textContent).toBe('The server did not accept this token: A valid host token is required.')
    expect(screen.queryByRole('navigation', { name: 'Steps' })).toBeNull()
    expect(await audit()).toEqual([])
  })

  // A token the server knows, for somebody who is not an administrator: what
  // whoami says it names is shown, so the person sees WHICH roles the host put
  // in it -- the wrong claim mapping is the usual mistake, and it is visible.
  test('shows who a token names when its roles are not an administrator’s', async () => {
    await tryToken(TOKENS.clerk)
    expect((await screen.findByRole('alert')).textContent).toBe('The administrator plane refused this token: This action needs an administrator role.')
    expect(identity(screen.getByRole('region', { name: 'Who this token names' }))).toEqual({ Actor: 'clerk-7', Roles: 'clerk', tenant: '1' })
    expect(screen.queryByRole('navigation', { name: 'Steps' })).toBeNull()
    expect(await audit()).toEqual([])
  })

  // An administrator signs in and the server's answer stays in view; and the
  // token is not kept anywhere a later visitor to this browser could find it.
  test('signs an administrator in, and keeps the token nowhere but in memory', async () => {
    await signIn(plane)
    const who = screen.getByRole('region', { name: 'Signed in' })
    expect(identity(who)).toEqual({ Actor: 'ada', Roles: 'data-admin', tenant: '1' })
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
    expect(document.cookie).toBe('')
    expect(document.body.innerHTML).not.toContain(TOKENS.admin)
    expect(paragraphs(who).join(' ')).toMatch(/held in this tab.s memory.*reloading the page signs you out/i)
    expect(unnamed()).toEqual([])
    expect(await audit()).toEqual([])
  })

  // The sign-in screen says where the token goes before it is pasted, so the
  // claim is made where the decision to paste is.
  test('says where the token goes before it is pasted', () => {
    mount(plane.fetch)
    expect(paragraphs(screen.getByRole('main', { name: 'Sign in to the studio' })).join(' ')).toMatch(/held in this tab.s memory.*not written to storage, a cookie or the address/i)
  })

  // Signing out forgets the client and the token with it: the next screen is
  // the empty sign-in form, not a studio still able to call the server.
  test('signing out forgets the token', async () => {
    const user = await signIn(plane)
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    expect((screen.getByLabelText('Host token') as HTMLInputElement).value).toBe('')
    expect(screen.queryByRole('navigation', { name: 'Steps' })).toBeNull()
  })

  // A server started without the administrator plane answers 404 for it; the
  // studio says what that means rather than "not found".
  test('says so when the server has no administrator plane', async () => {
    const bare: typeof fetch = async (input, init) =>
      String(input).endsWith('/v1/whoami') ? plane.fetch(input, init) : new Response(JSON.stringify({ message: 'Route GET:/v1/connections not found', error: 'Not Found', statusCode: 404 }), { status: 404 })
    const user = userEvent.setup()
    mount(bare)
    await user.type(screen.getByLabelText('Host token'), TOKENS.admin)
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/has no administrator plane/)
  })
})
