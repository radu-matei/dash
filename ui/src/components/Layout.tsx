import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import {
  Activity,
  Database,
  Key,
  LayoutDashboard,
  ScrollText,
  Settings,
  TrendingUp,
  Zap,
} from 'lucide-react'
import { getApp, type AppInfo } from '../api/client'

// ─── Status helpers ───────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  starting: 'bg-amber-400 animate-pulse',
  running:  'bg-green-500',
  stopped:  'bg-gray-400',
  error:    'bg-red-500',
}

const STATUS_LABELS: Record<string, string> = {
  starting: 'Starting',
  running:  'Running',
  stopped:  'Stopped',
  error:    'Error',
}

// ─── Navigation config ────────────────────────────────────────────────────────

const NAV_SECTIONS = [
  {
    label: 'Application',
    items: [
      { to: '/app',     label: 'Overview', Icon: LayoutDashboard },
      { to: '/logs',    label: 'Logs',     Icon: ScrollText },
      { to: '/traces',  label: 'Traces',   Icon: Activity },
      { to: '/metrics', label: 'Metrics',  Icon: TrendingUp },
    ],
  },
  {
    label: 'Storage',
    items: [
      { to: '/sqlite', label: 'SQLite',    Icon: Database },
      { to: '/kv',     label: 'KV Store',  Icon: Key },
    ],
  },
  {
    label: 'Configuration',
    items: [
      { to: '/vars', label: 'Variables', Icon: Settings },
    ],
  },
]

// ─── Spin logo SVG ────────────────────────────────────────────────────────────

function SpinLogo({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="16" cy="16" r="14" fill="#34E8BD" />
      <path
        d="M16 8a8 8 0 1 1 0 16A8 8 0 0 1 16 8zm0 3a5 5 0 1 0 0 10A5 5 0 0 0 16 11z"
        fill="#0D203F"
      />
      <circle cx="16" cy="16" r="2" fill="#0D203F" />
    </svg>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Layout() {
  const [app, setApp] = useState<AppInfo | null>(null)

  useEffect(() => {
    let active = true
    const poll = async () => {
      try {
        const info = await getApp()
        if (active) setApp(info)
      } catch { /* ignore */ }
    }
    poll()
    const id = setInterval(poll, 2000)
    return () => { active = false; clearInterval(id) }
  }, [])

  const status = app?.status ?? 'starting'

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      {/* ── Sidebar ──────────────────────────────────────────── */}
      <aside className="flex flex-col w-56 shrink-0 bg-white border-r border-gray-200">
        {/* Logo + app name */}
        <div className="flex items-center gap-3 px-4 h-16 border-b border-gray-200 shrink-0">
          <SpinLogo />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate">
              {app?.name ?? 'Spin Dashboard'}
            </p>
            <p className="text-xs text-gray-500">local · dev</p>
          </div>
        </div>

        {/* Status banner */}
        <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-gray-100 bg-gray-50 shrink-0">
          <span className={`status-dot ${STATUS_COLORS[status]}`} />
          <span className="text-xs font-medium text-gray-600">
            {STATUS_LABELS[status]}
          </span>
          {status === 'error' && app?.error && (
            <span className="text-xs text-red-600 truncate" title={app.error}>
              — {app.error.split('\n')[0]}
            </span>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-4">
          {NAV_SECTIONS.map(section => (
            <div key={section.label}>
              <p className="section-label">{section.label}</p>
              <ul className="space-y-0.5">
                {section.items.map(({ to, label, Icon }) => (
                  <li key={to}>
                    <NavLink
                      to={to}
                      className={({ isActive }) =>
                        isActive ? 'nav-item-active' : 'nav-item-inactive'
                      }
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      {label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-gray-100 shrink-0">
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <Zap className="w-3 h-3 text-fermyon-seagreen" />
            <span>spin dashboard v0.1.0</span>
          </div>
        </div>
      </aside>

      {/* ── Main content ─────────────────────────────────────── */}
      <main className="flex-1 flex flex-col overflow-hidden min-w-0">
        <Outlet />
      </main>
    </div>
  )
}
