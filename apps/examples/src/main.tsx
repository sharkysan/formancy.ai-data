import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@formancy/themes/blueprint.css'
import './app.css'
import { App } from './app.js'

const root = document.getElementById('root')
if (root === null) throw new Error('index.html has no #root to render into')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
