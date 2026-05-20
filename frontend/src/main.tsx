import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './utils/debugLog'
import App from './App.tsx'
import { bootstrapDemoMode } from './adapters/demo/index'

const TestingChart = lazy(() =>
  import('./components/chart/TestingChart').then((m) => ({ default: m.TestingChart }))
)

const params = new URLSearchParams(window.location.search)
const test   = params.get('test')

// Demo mode: intercepts all REST + WebSocket, runs with synthetic NQ data.
// Activate with ?demo=true  OR  build-time VITE_DEMO=true env var
if (params.get('demo') === 'true' || import.meta.env.VITE_DEMO === 'true') {
  bootstrapDemoMode()
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {test === 'orderline' ? (
      <Suspense fallback={null}>
        <TestingChart />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
)
