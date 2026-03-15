import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import {
  Activity,
  ExternalLink,
  FlaskConical,
  LayoutDashboard,
  ScrollText,
  TrendingUp,
} from 'lucide-react'
import { useAppStore } from '../store/appContext'

// ─── Status helpers ───────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  starting: 'bg-amber-400 animate-pulse',
  running: 'bg-spin-seagreen',
  stopped: 'bg-gray-500',
  error: 'bg-red-400',
}

const STATUS_LABELS: Record<string, string> = {
  starting: 'Starting',
  running: 'Running',
  stopped: 'Stopped',
  error: 'Error',
}

// ─── Navigation config ────────────────────────────────────────────────────────

const NAV_SECTIONS = [
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
    label: 'Testing',
    items: [
      { to: '/tests', label: 'HTTP Tests', Icon: FlaskConical },
    ],
  },
]


// ─── Component ────────────────────────────────────────────────────────────────

const REPO = 'https://github.com/radu-matei/dash'

export default function Layout() {
  const { app } = useAppStore()
  const status = app?.status ?? 'starting'

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
      <aside className="flex flex-col w-56 shrink-0 bg-spin-oxfordblue">
        {/* Logo + app name */}
        <div className="flex items-center gap-3 px-4 h-14 border-b border-white/[0.10] shrink-0">
          <img src="/spin-favicon.png" className="w-7 h-7 rounded shrink-0 invert" alt="Spin" />
          <div className="min-w-0">
            <div className="text-sm font-bold tracking-wide text-white leading-none">SPIN</div>
            <p className="text-[11px] text-gray-300 truncate mt-0.5">
              {app?.name ?? 'dashboard'} · local
            </p>
          </div>
        </div>

        {/* Status banner */}
        <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-white/[0.08] bg-white/[0.03] shrink-0">
          <span className={`status-dot ${STATUS_COLORS[status]}`} />
          <span className="text-xs font-medium text-gray-200">
            {STATUS_LABELS[status]}
          </span>
          {status === 'error' && app?.error && (
            <span className="text-xs text-red-400 truncate" title={app.error}>
              — {app.error.split('\n')[0]}
            </span>
          )}
        </div>

        {/* Open app link — only shown when --listen was provided */}
        {app?.listenAddr && (
          <a
            href={app.listenAddr}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 mx-3 my-2 px-3 py-2 rounded-lg bg-spin-seagreen/10 hover:bg-spin-seagreen/[0.18] transition-colors group shrink-0"
            title={`Open app at ${app.listenAddr}`}
          >
            <ExternalLink className="w-3.5 h-3.5 text-spin-seagreen shrink-0" />
            <span className="text-xs font-medium text-spin-seagreen/90 truncate flex-1">
              {app.listenAddr.replace(/^https?:\/\//, '')}
            </span>
          </a>
        )}

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
        <div className="px-4 py-3 border-t border-white/[0.08] shrink-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <img src="/spin-favicon.png" className="w-4 h-4 opacity-40 shrink-0 invert" alt="" />
            <span className="text-[11px] text-gray-400 shrink-0">spin dashboard</span>
            {sha && (
              <>
                <span className="text-gray-500 text-[11px]">·</span>
                <a
                  href={`${REPO}/commit/${sha.replace(/-dev$/, '')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] text-gray-400 hover:text-gray-200 font-mono truncate transition-colors"
                  title={`Commit ${sha}`}
                >
                  {sha}
                </a>
              </>
            )}
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
