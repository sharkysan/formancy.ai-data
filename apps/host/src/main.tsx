import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// The room's faces, from this build rather than a font service (0072): the
// weights the pages draw with, every subset, as Fontsource ships them.
import '@fontsource-variable/archivo/wght.css'
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import '@formancy/themes/blueprint.css'
import './host.css'
import { demoBase, demoSession } from './demo.js'
import { Host } from './host.js'

const root = document.getElementById('root')
if (root === null) throw new Error('index.html has no #root to render into')

// The browser's own fetch, bound: the page is served from the data server's
// origin, so every request the client makes is same-origin (0024, 0029).
const fetch = window.fetch.bind(window)

// Built with `--mode demo` (`build:demo`), the page is the live demo's
// (0070): its routes are beside its files, wherever it is served, and a
// visitor signs in as one of the demo's people. Vite writes the mode into
// the build as a constant, so the ordinary build drops this branch and
// demo.ts with it. It keeps persona-sign-in.tsx, which sign-in.tsx imports
// and renders only when given a session, which nothing gives it there.
const demo = import.meta.env.MODE === 'demo'
const base = demo ? demoBase(window.location.pathname) : ''

createRoot(root).render(
  <StrictMode>
    <Host fetch={fetch} base={base} session={demo ? demoSession(fetch, base) : undefined} />
  </StrictMode>,
)
