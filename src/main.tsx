import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/global.css'
import App from './App'

function handleShellNavigation(event: MouseEvent) {
  const target = event.target as HTMLElement | null
  const navButton = target?.closest<HTMLButtonElement>('.main-nav .nav-item')

  if (!navButton) return

  const label = navButton.textContent?.trim()

  if (label === 'Billing') {
    window.location.href = '/billing'
  }
}

document.addEventListener('click', handleShellNavigation)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
