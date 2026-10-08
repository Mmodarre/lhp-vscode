import { createRoot } from 'react-dom/client'
import { App } from './App'
import '@xyflow/react/dist/style.css'
import './styles.css'

const element = document.getElementById('root')
if (!element) throw new Error('LHP webview root element is missing')
createRoot(element).render(<App />)
