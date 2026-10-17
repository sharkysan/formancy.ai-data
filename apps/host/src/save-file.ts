import { createContext } from 'react'

/*
 * Handing a file the page made to the browser to save (0080). A page that
 * holds the bytes -- the token travels in a header, so the browser cannot
 * be sent to the route itself -- saves them the one way every browser
 * offers a page: an object URL of the bytes, an `<a download>` clicked.
 */

/** What the page does with a file it made, and the name to save it under. */
export type SaveFile = (file: Blob, name: string) => void

/**
 * The browser's download of `file` as `name`: an object URL of it, an
 * `<a download>` put in the document, clicked and taken out again, and the
 * URL revoked in the task after the click, which lets the bytes go. The
 * anchor is in the document while it is clicked, and the URL outlives the
 * click's own task: every combination of the two -- anchor in or out,
 * revoked at once or a task later -- saved the file whole ten times in ten
 * in Chromium 153.0.8010.12 and Firefox 155.0 on Windows 11 on 2026-10-17,
 * so this is the combination that needs the least of a browser. The browser
 * gate holds it in each browser it runs, WebKit among them on Linux
 * (scripts/browser/exporting.mjs).
 */
export function saveFile(file: Blob, name: string): void {
  const url = URL.createObjectURL(file)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** How the page saves a file: the browser's download, unless the page is mounted with another (host.tsx). */
export const SaveContext = createContext<SaveFile>(saveFile)
