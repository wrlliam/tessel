import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import './styles.css'

// iOS ignores user-scalable=no; block pinch zoom directly.
document.addEventListener('gesturestart', (e) => e.preventDefault())

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
