import { useEffect, useState } from 'react'

/**
 * How many times the page's web fonts have finished loading since it was
 * drawn (0151): when the page's fonts are ready, and each time a later load
 * ends. A canvas measures a word in a fallback face until its face has
 * loaded, so a grid measures its headers' floors again with each count
 * (widths.ts's `headerFloor`). Nothing where the document has no
 * FontFaceSet, as jsdom has none.
 */
export function useFontsLoaded(): number {
  const [loaded, setLoaded] = useState(0)
  useEffect(() => {
    if (!('fonts' in document)) return undefined
    const fonts = document.fonts
    let live = true
    const again = (): void => {
      if (live) setLoaded((count) => count + 1)
    }
    void fonts.ready.then(again)
    fonts.addEventListener('loadingdone', again)
    return () => {
      live = false
      fonts.removeEventListener('loadingdone', again)
    }
  }, [])
  return loaded
}
