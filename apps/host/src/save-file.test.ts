import { afterEach, expect, test } from 'vitest'
import { saveFile } from './save-file.js'

/*
 * The browser's download of a file the page made (0080), in the one part
 * jsdom can show: what the anchor is given, that it is in the document when
 * it is clicked and gone after, and when the object URL is let go. jsdom has
 * no `URL.createObjectURL` and saves nothing, so both URL functions are
 * stood in for here, and whether a browser saves the file whole is the
 * browser gate's (scripts/browser/exporting.mjs).
 *
 * Read from the DOM, which the accessibility tree cannot answer: an anchor
 * with no text has no name, and whether an element is connected is not a
 * role's.
 */

afterEach(() => {
  Reflect.deleteProperty(URL, 'createObjectURL')
  Reflect.deleteProperty(URL, 'revokeObjectURL')
})

// The combination save-file.ts chose, which the browser gate measures in
// every browser it runs: the anchor in the document while it is clicked,
// and the URL revoked in a later task. Either changed is a combination no
// WebKit leg has saved a file through (watched failing with the anchor left
// out of the document: no click reached it, since a click on an anchor that
// is not connected bubbles to nothing; and with the URL revoked at once:
// revoked before the click's task ended).
test('clicks an anchor in the document, named for the file, takes it out, and revokes the URL a task later', async () => {
  const given: Blob[] = []
  const revoked: string[] = []
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: (blob: Blob) => (given.push(blob), 'blob:http://host.test/0b1d') })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: (url: string) => void revoked.push(url) })
  const clicks: Array<{ href: string; download: string; connected: boolean; revoked: number }> = []
  const heard = (event: MouseEvent): void => {
    const anchor = event.target as HTMLAnchorElement
    clicks.push({ href: anchor.href, download: anchor.download, connected: anchor.isConnected, revoked: revoked.length })
    // jsdom does not navigate; a browser downloads here.
    event.preventDefault()
  }
  document.addEventListener('click', heard)
  try {
    const file = new Blob(['﻿Id\r\n1\r\n'], { type: 'text/csv' })
    saveFile(file, 'pg-order.csv')
    expect(given).toEqual([file])
    expect(clicks).toEqual([{ href: 'blob:http://host.test/0b1d', download: 'pg-order.csv', connected: true, revoked: 0 }])
    expect(document.querySelectorAll('a[download]')).toHaveLength(0)
    expect(revoked).toEqual([])
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(revoked).toEqual(['blob:http://host.test/0b1d'])
  } finally {
    document.removeEventListener('click', heard)
  }
})
