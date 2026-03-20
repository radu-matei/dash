import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppProvider } from './store/appContext'
import { LogProvider } from './store/logContext'
import { TestRunProvider } from './store/testRunContext'
import { CommandPaletteProvider } from './components/CommandPalette'
import Layout from './components/Layout'
import AppOverview from './components/AppOverview'
import LogViewer from './components/LogViewer'
import TraceViewer from './components/TraceViewer'
import MetricsPage from './components/MetricsPage'
import HttpTesting from './components/HttpTesting'
import KVExplorer from './components/KVExplorer'

export default function App() {
  return (
    <AppProvider>
    <LogProvider>
    <TestRunProvider>
      <BrowserRouter>
      <CommandPaletteProvider>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Navigate to="/app" replace />} />
            <Route path="app" element={<AppOverview />} />
            <Route path="logs" element={<LogViewer />} />
            <Route path="traces" element={<TraceViewer />} />
            <Route path="metrics" element={<MetricsPage />} />
            <Route path="kv" element={<KVExplorer />} />
            <Route path="tests" element={<HttpTesting />} />
          </Route>
        </Routes>
      </CommandPaletteProvider>
      </BrowserRouter>
    </TestRunProvider>
    </LogProvider>
    </AppProvider>
  )
}
