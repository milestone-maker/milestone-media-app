// Sentry must be imported first so init runs before any React code.
import { Sentry } from './sentry.js'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Sentry.ErrorBoundary fallback={<div style={{ padding: 24, fontFamily: 'sans-serif' }}>Something went wrong.</div>}>
      <App />
    </Sentry.ErrorBoundary>
  </React.StrictMode>
)
