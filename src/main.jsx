import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import App from './App.jsx'
import { AppStateProvider } from './context/AppState.jsx'
import ReplyDesk from './pages/ReplyDesk.jsx'
import ConnectedVideos from './pages/ConnectedVideos.jsx'
import SentReplies from './pages/SentReplies.jsx'
import './styles.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AppStateProvider>
        <Routes>
          <Route element={<App />}>
            <Route path="/" element={<ReplyDesk />} />
            <Route path="/reply-desk/:videoId" element={<ReplyDesk />} />
            <Route path="/videos" element={<ConnectedVideos />} />
            <Route path="/sent" element={<SentReplies />} />
          </Route>
        </Routes>
      </AppStateProvider>
    </BrowserRouter>
  </StrictMode>
)
