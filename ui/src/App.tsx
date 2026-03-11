import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppProvider } from './store/appContext'
import { LogProvider } from './store/logContext'
import Layout from './components/Layout'
import AppOverview from './components/AppOverview'
import LogViewer from './components/LogViewer'
import TraceViewer from './components/TraceViewer'
import MetricsPage from './components/MetricsPage'
import VarInspector from './components/VarInspector'

export default function App() {
  return (
    <AppProvider>
    <LogProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Navigate to="/app" replace />} />
            <Route path="app" element={<AppOverview />} />
            <Route path="logs" element={<LogViewer />} />
            <Route path="traces" element={<TraceViewer />} />
            <Route path="metrics" element={<MetricsPage />} />
            <Route path="vars" element={<VarInspector />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </LogProvider>
    </AppProvider>
  )
}
