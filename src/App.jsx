import { Outlet } from 'react-router-dom'
import Sidebar from './components/Sidebar.jsx'
import CategoriesPanel from './components/CategoriesPanel.jsx'
import HelpModal from './components/HelpModal.jsx'
import AccountModal from './components/AccountModal.jsx'
import { useAppState } from './context/AppState.jsx'

// Top-level layout: fixed sidebar + whichever page the router selected.
// Mirrors the original main.jsx's <div className="app-shell"> structure.
export default function App() {
  const {
    categoriesOpen, setCategoriesOpen, categories, categoriesLoading, categoriesError, saveCategory, addCategory, deleteCategory,
    helpOpen, setHelpOpen, accountOpen, setAccountOpen, creator, liveSession, disconnect,
  } = useAppState()

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="main-content">
        <Outlet />
      </main>
      {categoriesOpen && (
        <CategoriesPanel
          categories={categories}
          loading={categoriesLoading}
          error={categoriesError}
          onSave={saveCategory}
          onAdd={addCategory}
          onDelete={deleteCategory}
          onClose={() => setCategoriesOpen(false)}
        />
      )}
      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}
      {accountOpen && (
        <AccountModal
          creator={creator}
          liveSession={liveSession}
          onClose={() => setAccountOpen(false)}
          onDisconnect={disconnect}
        />
      )}
    </div>
  )
}
