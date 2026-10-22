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
// The admin's palette, from formancy rather than copied (0096).
import '@formancy/themes/room.css'
import './studio.css'
import { Studio } from './studio.js'

const root = document.getElementById('root')
if (root === null) throw new Error('index.html has no #root to render into')

// The browser's own fetch, bound: the studio is served from the data server's
// origin, so every request it makes is same-origin (0024).
createRoot(root).render(
  <StrictMode>
    <Studio fetch={window.fetch.bind(window)} />
  </StrictMode>,
)
