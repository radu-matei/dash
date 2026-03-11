import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { LogProvider } from './store/logContext'
import Layout from './components/Layout'
import AppOverview from './components/AppOverview'
import LogViewer from './components/LogViewer'
import TraceViewer from './components/TraceViewer'
import MetricsPage from './components/MetricsPage'
import SQLiteExplorer from './components/SQLiteExplorer'
import KVExplorer from './components/KVExplorer'
import VarInspector from './components/VarInspector'

export default function App() {
  return (
    <LogProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Navigate to="/app" replace />} />
            <Route path="app" element={<AppOverview />} />
            <Route path="logs" element={<LogViewer />} />
            <Route path="traces" element={<TraceViewer />} />
            <Route path="metrics" element={<MetricsPage />} />
            <Route path="sqlite" element={<SQLiteExplorer />} />
            <Route path="kv" element={<KVExplorer />} />
            <Route path="vars" element={<VarInspector />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </LogProvider>
  )
}
