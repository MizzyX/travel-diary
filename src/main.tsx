import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { StoreProvider } from './state/store'
import { CloudProvider } from './state/cloud'
import { ToastProvider } from './components/Toast'
import { UpdateBar } from './components/UpdateBar'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider>
      <ToastProvider>
        <CloudProvider>
          <App />
          <UpdateBar />
        </CloudProvider>
      </ToastProvider>
    </StoreProvider>
  </StrictMode>
)
