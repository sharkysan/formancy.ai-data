import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@formancy/themes/blueprint.css'
import './host.css'
import { Host } from './host.js'

const root = document.getElementById('root')
if (root === null) throw new Error('index.html has no #root to render into')

// The browser's own fetch, bound: the page is served from the data server's
// origin, so every request the client makes is same-origin (0024, 0029).
createRoot(root).render(
  <StrictMode>
    <Host fetch={window.fetch.bind(window)} />
  </StrictMode>,
)
