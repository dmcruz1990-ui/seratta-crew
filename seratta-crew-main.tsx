import React from 'react'
import ReactDOM from 'react-dom/client'
import SerattaCrewApp from './SerattaCrewApp'
import './index.css'

// Registrar Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SerattaCrewApp />
  </React.StrictMode>
)
