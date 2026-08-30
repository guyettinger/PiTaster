import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'

// Fonts are bundled rather than fetched: the renderer CSP is `default-src 'self'`,
// so a hosted font service is blocked. Archivo's `standard` build carries both the
// weight and width axes, which is where the condensed eyebrow voice comes from.
import '@fontsource-variable/archivo/standard.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'

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
