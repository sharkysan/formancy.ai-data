import { useEffect, useMemo, useRef } from 'react'
import type { LookupOffer, NamedOpen } from './lookup-opens.js'

/**
 * A pane's offer as its renderers are handed it (0141): the same object for
 * as long as its Opens say the same -- compared by what they say, not by the
 * array, which a Drill down level makes again on each render -- and a press
 * read through a ref, so it reaches the handler of the page's latest render.
 * React's field addition is made once per offer, and a new one each render
 * would redraw every field's addition; Angular is handed one as it starts.
 */
export function useSteadyOffer(offer: LookupOffer | undefined): LookupOffer | undefined {
  const pressed = useRef(offer)
  useEffect(() => {
    pressed.current = offer
  })
  const said = offer === undefined ? null : JSON.stringify(offer.opens)
  return useMemo<LookupOffer | undefined>(
    () =>
      said === null ? undefined : { opens: JSON.parse(said) as NamedOpen[], open: (field, choice, button) => pressed.current?.open(field, choice, button) },
    [said],
  )
}
