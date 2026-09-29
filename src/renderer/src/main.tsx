import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { AppProvider } from './store/AppStore'
import './styles/global.css'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </React.StrictMode>
)
