import { describe, expect, test } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { LookupOffer, NamedOpen, OpenChoice } from './lookup-opens.js'
import { useSteadyOffer } from './steady-offer.js'

/*
 * The offer a pane hands its renderers (0141), across the page's renders.
 * React's field addition is made once per offer (react-form.tsx), and a
 * new one each render redraws every field's addition, so the offer must be
 * the same object for as long as its Opens say the same -- while a Drill
 * down level makes its Opens again on every render (`levelOpens`). No
 * database: the hook is asked as the pane asks it.
 */

const OPENS: NamedOpen[] = [{ field: 'customer', forms: [{ id: 'pg-customer', title: 'Customers', label: 'Open in Customers' }] }]

const CHOICE: OpenChoice = { form: { id: 'pg-customer', title: 'Customers' }, token: 'k1:7', label: 'Open in Customers' }

/** An offer over a copy of `opens`, made afresh as a level makes one, whose presses are written down as `said`. */
const offerOf = (opens: NamedOpen[], heard: string[], said: string): LookupOffer => ({
  opens: structuredClone(opens),
  open: () => void heard.push(said),
})

describe("a pane's offer", () => {
  // A level's Opens, made again by the next render, say what they said:
  // the renderers keep the offer they hold, so no field's addition is
  // drawn again for a render of the page (watched failing with the offer
  // made again whenever its array was another).
  test('is the same while its Opens say the same, whatever array holds them', () => {
    const { result, rerender } = renderHook(({ offer }) => useSteadyOffer(offer), { initialProps: { offer: offerOf(OPENS, [], 'first') } })
    const first = result.current
    rerender({ offer: offerOf(OPENS, [], 'second') })
    expect(result.current).toBe(first)
  })

  // The offer kept is the first, but a press must reach what the page's
  // latest render would do with it -- the level and the line it is on now
  // (watched failing with the press read from the first offer).
  test("hands a press to the latest render's handler", () => {
    const heard: string[] = []
    const { result, rerender } = renderHook(({ offer }) => useSteadyOffer(offer), { initialProps: { offer: offerOf(OPENS, heard, 'first') } })
    rerender({ offer: offerOf(OPENS, heard, 'second') })
    result.current?.open('customer', CHOICE, document.createElement('button'))
    expect(heard).toEqual(['second'])
  })

  // Opens that say something else are another offer, which the renderers
  // draw afresh (watched failing with the offer kept whatever it said).
  test('is another once its Opens say something else, and none for none', () => {
    const { result, rerender } = renderHook<LookupOffer | undefined, { offer: LookupOffer | undefined }>(({ offer }) => useSteadyOffer(offer), {
      initialProps: { offer: offerOf(OPENS, [], 'first') },
    })
    const first = result.current
    const renamed: NamedOpen[] = [{ field: 'customer', forms: [{ id: 'pg-customer', title: 'Customers', label: 'Open Customer in Customers' }] }]
    rerender({ offer: offerOf(renamed, [], 'second') })
    expect(result.current).not.toBe(first)
    expect(result.current?.opens).toEqual(renamed)
    rerender({ offer: undefined })
    expect(result.current).toBeUndefined()
  })
})
