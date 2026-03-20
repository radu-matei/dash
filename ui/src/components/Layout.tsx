import { useCallback, useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  Activity,
  ChevronsLeft,
  ChevronsRight,
  Database,
  ExternalLink,
  FlaskConical,
  LayoutDashboard,
  ScrollText,
  Search,
  TrendingUp,
} from 'lucide-react'
import { useAppStore } from '../store/appContext'
import { useCommandPalette } from './CommandPalette'

// ─── Status helpers ───────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  starting:   'bg-amber-400 animate-pulse',
  building:   'bg-blue-400 animate-pulse',
  restarting: 'bg-amber-400 animate-pulse',
  running:    'bg-spin-seagreen',
  stopped:    'bg-gray-500',
  error:      'bg-red-400',
}

const STATUS_LABELS: Record<string, string> = {
  starting:   'Starting',
  building:   'Building…',
  restarting: 'Restarting…',
  running:    'Running',
  stopped:    'Stopped',
  error:      'Error',
}

// ─── Navigation config ────────────────────────────────────────────────────────

type NavItem = { to: string; label: string; Icon: typeof LayoutDashboard }
type NavSection = { label: string; items: NavItem[] }

function buildNavSections(): NavSection[] {
  const sections: NavSection[] = [
    {
      label: 'Application',
      items: [
        { to: '/app', label: 'Overview', Icon: LayoutDashboard },
        { to: '/logs', label: 'Logs', Icon: ScrollText },
        { to: '/traces', label: 'Traces', Icon: Activity },
        { to: '/metrics', label: 'Metrics', Icon: TrendingUp },
      ],
    },
    {
      label: 'Data',
      items: [
        { to: '/kv', label: 'KV Explorer', Icon: Database },
      ],
    },
  ]
  sections.push({
    label: 'Testing',
    items: [
      { to: '/tests', label: 'HTTP Tests', Icon: FlaskConical },
    ],
  })
  return sections
}

// ─── Persist sidebar state ───────────────────────────────────────────────────

const COLLAPSED_KEY = 'spin-sidebar-collapsed'

function useCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSED_KEY) === '1' } catch { return false }
  })
  const toggle = useCallback(() => {
    setCollapsed(prev => {
      const next = !prev
      try { localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0') } catch { /* */ }
      return next
    })
  }, [])
  return [collapsed, toggle]
}

// ─── Component ────────────────────────────────────────────────────────────────

const REPO = 'https://github.com/radu-matei/dash'

export default function Layout() {
  const { app } = useAppStore()
  const { open: openPalette } = useCommandPalette()
  const status = app?.status ?? 'starting'
  const [collapsed, toggle] = useCollapsed()
  const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.userAgent)
  const location = useLocation()
  const navSections = buildNavSections()
  const pageTitle = navSections
    .flatMap(s => s.items)
    .find(i => location.pathname.startsWith(i.to))?.label

  useEffect(() => {
    const appName = app?.name ?? 'dashboard'
    document.title = pageTitle ? `${pageTitle} · Spin – ${appName}` : `Spin – ${appName}`
  }, [pageTitle, app?.name])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'b' && !e.shiftKey) {
        e.preventDefault()
        toggle()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [toggle])

  const [sha, setSha] = useState<string | null>(null)
  useEffect(() => {
    fetch('/api/version')
      .then(r => r.json())
      .then((d: { sha?: string }) => setSha(d.sha ?? null))
      .catch(() => { })
  }, [])

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      {/* ── Sidebar ──────────────────────────────────────────── */}
      <aside
        className={`flex flex-col shrink-0 bg-spin-oxfordblue transition-[width] duration-200 ease-in-out ${
          collapsed ? 'w-14' : 'w-56'
        }`}
      >
        {/* Logo + app name */}
        <div className={`flex items-center h-14 border-b border-white/[0.10] shrink-0 ${collapsed ? 'justify-center px-0' : 'gap-3 px-4'}`}>
          <img src="/spin-favicon.png" className="w-7 h-7 rounded shrink-0 invert" alt="Spin" />
          {!collapsed && (
            <div className="min-w-0">
              <a
                href="https://spinframework.dev"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-bold tracking-wide text-white leading-none hover:text-spin-seagreen transition-colors"
              >
                SPIN
              </a>
              <p className="text-[11px] text-gray-300 truncate mt-0.5">
                {app?.name ?? 'dashboard'}
              </p>
            </div>
          )}
        </div>

        {/* Status banner */}
        <div className={`flex items-center border-b border-white/[0.08] bg-white/[0.03] shrink-0 h-[37px] ${
          collapsed ? 'justify-center px-0' : 'gap-2.5 px-4'
        }`}>
          <span className={`status-dot ${STATUS_COLORS[status]}`} title={collapsed ? STATUS_LABELS[status] : undefined} />
          {!collapsed && (
            <>
              <span className="text-xs font-medium text-gray-200">
                {STATUS_LABELS[status]}
              </span>
              {status === 'error' && app?.error && (
                <span className="text-xs text-red-400 truncate" title={app.error}>
                  — {app.error.split('\n')[0]}
                </span>
              )}
            </>
          )}
        </div>

        {/* Search / command palette trigger */}
        <button
          onClick={openPalette}
          className={`flex items-center rounded-lg text-gray-400 hover:text-gray-200 hover:bg-white/[0.08] transition-colors shrink-0 ${
            collapsed ? 'justify-center mx-1.5 mt-2 px-0 py-2' : 'gap-2.5 mx-3 mt-2 px-3 py-2'
          }`}
          title={`Search (${isMac ? '⌘' : 'Ctrl+'}K)`}
        >
          <Search className="w-3.5 h-3.5 shrink-0" />
          {!collapsed && (
            <>
              <span className="text-xs flex-1 text-left">Search…</span>
              <kbd className="text-[10px] font-mono text-gray-500 bg-white/[0.08] px-1.5 py-0.5 rounded">
                {isMac ? '⌘K' : '⌃K'}
              </kbd>
            </>
          )}
        </button>

        {/* Open app link — only shown when --listen was provided */}
        {app?.listenAddr && (
          <a
            href={app.listenAddr}
            target="_blank"
            rel="noopener noreferrer"
            className={`flex items-center rounded-lg bg-spin-seagreen/10 hover:bg-spin-seagreen/[0.18] transition-colors shrink-0 ${
              collapsed ? 'justify-center mx-1.5 my-2 px-0 py-2' : 'gap-2 mx-3 my-2 px-3 py-2'
            }`}
            title={`Open app at ${app.listenAddr}`}
          >
            <ExternalLink className="w-3.5 h-3.5 text-spin-seagreen shrink-0" />
            {!collapsed && (
              <span className="text-xs font-medium text-spin-seagreen/90 truncate flex-1">
                {app.listenAddr.replace(/^https?:\/\//, '')}
              </span>
            )}
          </a>
        )}

        {/* Navigation */}
        <nav className={`flex-1 overflow-y-auto py-3 space-y-4 ${collapsed ? 'px-1.5' : 'px-2'}`}>
          {navSections.map(section => (
            <div key={section.label}>
              {!collapsed && <p className="section-label">{section.label}</p>}
              <ul className="space-y-0.5">
                {section.items.map(({ to, label, Icon }) => (
                  <li key={to}>
                    <NavLink
                      to={to}
                      title={collapsed ? label : undefined}
                      className={({ isActive }) =>
                        collapsed
                          ? `flex items-center justify-center w-full py-2 rounded-lg transition-all duration-150 ${
                              isActive
                                ? 'bg-spin-seagreen/[0.18] text-spin-seagreen'
                                : 'text-gray-300 hover:bg-white/[0.08] hover:text-white'
                            }`
                          : isActive ? 'nav-item-active' : 'nav-item-inactive'
                      }
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      {!collapsed && label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        {/* Footer: branding + version + collapse toggle */}
        <div className={`border-t border-white/[0.08] shrink-0 ${collapsed ? '' : 'px-4 py-2'}`}>
          {!collapsed && (
            <div className="flex items-center gap-2 mb-2 px-1">
              <a
                href="https://spinframework.dev"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 opacity-50 hover:opacity-90 transition-opacity"
                title="Spin Framework"
              >
                <img src="/spin-favicon.png" className="w-3.5 h-3.5 shrink-0 invert" alt="Spin" />
                <span className="text-[10px] font-medium text-gray-400">Spin</span>
              </a>
              <span className="text-gray-600 text-[10px]">·</span>
              <a
                href="https://www.cncf.io"
                target="_blank"
                rel="noopener noreferrer"
                className="opacity-40 hover:opacity-80 transition-opacity"
                title="A CNCF project"
              >
                <img src="/cncf-white.svg" className="h-3" alt="CNCF" />
              </a>
            </div>
          )}
          {!collapsed && sha && (
            <div className="flex items-center gap-1.5 min-w-0 mb-1.5 px-1">
              <span className="text-[10px] text-gray-500 shrink-0">dashboard</span>
              <span className="text-gray-600 text-[10px]">·</span>
              <a
                href={`${REPO}/commit/${sha.replace(/-dev$/, '')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] text-gray-500 hover:text-gray-300 font-mono truncate transition-colors"
                title={`Commit ${sha}`}
              >
                {sha}
              </a>
            </div>
          )}
          <button
            onClick={toggle}
            className={`flex items-center w-full text-gray-400 hover:text-white hover:bg-white/[0.06] rounded-lg transition-colors ${
              collapsed ? 'justify-center py-3' : 'gap-2 px-2 py-1.5'
            }`}
            title={`${collapsed ? 'Expand' : 'Collapse'} sidebar (${isMac ? '⌘' : 'Ctrl+'}B)`}
          >
            {collapsed
              ? <ChevronsRight className="w-4 h-4" />
              : (
                <>
                  <ChevronsLeft className="w-4 h-4 shrink-0" />
                  <span className="text-[11px] flex-1 text-left">Collapse</span>
                  <kbd className="text-[10px] font-mono text-gray-500 bg-white/[0.08] px-1.5 py-0.5 rounded">
                    {isMac ? '⌘B' : '⌃B'}
                  </kbd>
                </>
              )
            }
          </button>
        </div>
      </aside>

      {/* ── Main content ─────────────────────────────────────── */}
      <main className="flex-1 flex flex-col overflow-hidden min-w-0">
        <Outlet />
      </main>
    </div>
  )
}
