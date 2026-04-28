import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './utils/debugLog'
import App from './App.tsx'

const TestingChart = lazy(() =>
  import('./components/chart/TestingChart').then((m) => ({ default: m.TestingChart }))
)

const test = new URLSearchParams(window.location.search).get('test')

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
