import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@formancy/themes/blueprint.css'
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
