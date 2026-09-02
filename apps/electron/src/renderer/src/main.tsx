import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'

// Fonts are bundled rather than fetched: the renderer CSP is `default-src 'self'`,
// so a hosted font service is blocked. Archivo's `standard` build carries both the
// weight and width axes, which is where the condensed eyebrow voice comes from.
import '@fontsource-variable/archivo/standard.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'

// dockview's base stylesheet, before ours: the dock's own theme block in
// globals.css layers on top of these defaults, and Tailwind's utilities must
// be able to win against them.
import 'dockview-react/dist/styles/dockview.css'

import './styles/globals.css'

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('Root element not found')
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>
)
